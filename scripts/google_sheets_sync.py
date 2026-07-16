"""Mirror V workspaces into the Google Sheets prototype.

The Electron main process writes a compact JSON snapshot and invokes this script.
Only the two sheets owned by V ("V" and "V hub") are replaced.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

import gspread
from gspread.exceptions import WorksheetNotFound


CARD_COLUMNS = 24
GALLERY_COLUMNS = 5
CARD_COLUMN_WIDTH = 4
CARD_COLUMN_GAP = 1
MAX_CELL_CHARS = 45_000
DEFAULT_ACCENT = "#7065E8"
MANIFEST_SHEET_TITLE = "_V sync"
DRIVE_ASSET_FOLDER = "V Sheets Assets"
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]


class _PlainTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"br", "p", "div", "li", "section", "blockquote", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"p", "div", "li", "section", "blockquote", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def html_to_text(value: Any) -> str:
    parser = _PlainTextParser()
    parser.feed(str(value or ""))
    lines = [" ".join(line.split()) for line in "".join(parser.parts).splitlines()]
    return "\n".join(line for line in lines if line).strip()


def compact(value: Any, limit: int = MAX_CELL_CHARS) -> str:
    text = str(value or "").replace("\x00", "").strip()
    if len(text) <= limit:
        return text
    return f"{text[: limit - 80]}\n\n… текст сокращён для Google Таблиц …"


def hex_color(value: Any, fallback: str = DEFAULT_ACCENT) -> str:
    text = str(value or "").strip()
    if len(text) == 4 and text.startswith("#"):
        text = "#" + "".join(char * 2 for char in text[1:])
    if len(text) != 7 or not text.startswith("#"):
        return fallback
    try:
        int(text[1:], 16)
    except ValueError:
        return fallback
    return text.upper()


def rgb(value: str) -> dict[str, float]:
    value = hex_color(value)
    return {
        "red": int(value[1:3], 16) / 255,
        "green": int(value[3:5], 16) / 255,
        "blue": int(value[5:7], 16) / 255,
    }


def tint(value: str, amount: float = 0.88) -> dict[str, float]:
    color = rgb(value)
    return {channel: component + (1 - component) * amount for channel, component in color.items()}


def foreground(value: str) -> dict[str, float]:
    color = rgb(value)
    luminance = 0.2126 * color["red"] + 0.7152 * color["green"] + 0.0722 * color["blue"]
    return rgb("#171923" if luminance > 0.62 else "#FFFFFF")


def created_label(value: Any) -> str:
    try:
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000
        return datetime.fromtimestamp(timestamp).strftime("%d.%m.%Y %H:%M")
    except (TypeError, ValueError, OSError, OverflowError):
        return ""


def local_asset_path(source: Any) -> Path | None:
    value = str(source or "").strip()
    if not value:
        return None
    parsed = urlparse(value)
    if len(value) >= 3 and value[1] == ":" and value[2] in {"\\", "/"}:
        path = Path(value)
    elif parsed.scheme == "file":
        raw_path = url2pathname(unquote(parsed.path))
        if parsed.netloc:
            raw_path = f"//{parsed.netloc}{raw_path}"
        path = Path(raw_path)
    elif not parsed.scheme:
        path = Path(value)
    else:
        return None
    try:
        resolved = path.expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    return resolved if resolved.is_file() else None


def image_formula(image_url: Any) -> str:
    escaped = str(image_url or "").replace('"', '""')
    # A one-argument formula works in every spreadsheet locale; multi-argument
    # formulas require locale-specific comma/semicolon separators.
    return f'=IMAGE("{escaped}")'


def image_asset_entries(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    entries: list[dict[str, Any]] = []
    remote_count = 0
    workspaces = payload.get("workspaces") if isinstance(payload.get("workspaces"), list) else []
    for space_index, space in enumerate(workspaces):
        if not isinstance(space, dict):
            continue
        workspace_id = str(space.get("id") or f"workspace-{space_index}")
        cards = space.get("cards") if isinstance(space.get("cards"), list) else []
        for card_index, card in enumerate(cards):
            if not isinstance(card, dict) or card.get("type") != "image":
                continue
            source = str(card.get("src") or "").strip()
            if source.startswith(("https://", "http://")):
                card["_sheets_image_url"] = source
                remote_count += 1
                continue
            path = local_asset_path(source)
            if path:
                raw_key = f"card:{workspace_id}:{card.get('id') or card_index}"
                entries.append({"key": hashlib.sha256(raw_key.encode("utf-8")).hexdigest(), "target": card, "path": path, "title": card.get("title") or "Изображение"})
        knowledge = space.get("knowledge") if isinstance(space.get("knowledge"), dict) else {}
        items = knowledge.get("items") if isinstance(knowledge.get("items"), list) else []
        for item_index, item in enumerate(items):
            if not isinstance(item, dict) or item.get("type") != "image":
                continue
            source = str(item.get("imageSrc") or "").strip()
            if source.startswith(("https://", "http://")):
                item["_sheets_image_url"] = source
                remote_count += 1
                continue
            path = local_asset_path(source)
            if path:
                raw_key = f"hub:{workspace_id}:{item.get('id') or item_index}"
                entries.append({"key": hashlib.sha256(raw_key.encode("utf-8")).hexdigest(), "target": item, "path": path, "title": item.get("title") or "Изображение"})
    return entries, remote_count


def drive_credentials(oauth_client_path: Path, token_path: Path):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    credentials = None
    if token_path.is_file():
        try:
            credentials = Credentials.from_authorized_user_file(str(token_path), DRIVE_SCOPES)
        except (OSError, ValueError):
            credentials = None
    if credentials and credentials.expired and credentials.refresh_token:
        try:
            credentials.refresh(Request())
        except Exception:
            credentials = None
    if not credentials or not credentials.valid:
        flow = InstalledAppFlow.from_client_secrets_file(str(oauth_client_path), DRIVE_SCOPES)
        credentials = flow.run_local_server(port=0, open_browser=True)
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(credentials.to_json(), encoding="utf-8")
    return credentials


def list_drive_files(drive, query: str, fields: str) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    page_token = None
    while True:
        response = drive.files().list(q=query, spaces="drive", fields=f"nextPageToken,files({fields})", pageToken=page_token).execute()
        files.extend(response.get("files", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            return files


def prepare_image_assets(payload: dict[str, Any], oauth_client: str, token_file: str, share_images_by_link: bool = False) -> dict[str, Any]:
    entries, remote_count = image_asset_entries(payload)
    if not entries:
        return {"ok": True, "uploaded": 0, "reused": remote_count, "deleted": 0, "skipped": 0}
    if not share_images_by_link:
        return {"ok": True, "reason": "sharing_required", "uploaded": 0, "reused": remote_count, "deleted": 0, "skipped": len(entries)}
    oauth_client_path = Path(oauth_client)
    if not oauth_client_path.is_file():
        return {"ok": False, "reason": "oauth_client_missing", "uploaded": 0, "reused": remote_count, "deleted": 0, "skipped": len(entries)}

    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    credentials = drive_credentials(oauth_client_path, Path(token_file))
    drive = build("drive", "v3", credentials=credentials, cache_discovery=False)
    folders = list_drive_files(
        drive,
        f"mimeType='application/vnd.google-apps.folder' and name='{DRIVE_ASSET_FOLDER}' and trashed=false",
        "id,name",
    )
    if folders:
        folder_id = folders[0]["id"]
    else:
        folder = drive.files().create(
            body={"name": DRIVE_ASSET_FOLDER, "mimeType": "application/vnd.google-apps.folder", "appProperties": {"vManagedBy": "V"}},
            fields="id",
        ).execute()
        folder_id = folder["id"]

    existing_files = list_drive_files(
        drive,
        f"'{folder_id}' in parents and trashed=false",
        "id,name,appProperties,thumbnailLink,webContentLink",
    )
    existing_by_key = {
        str(file.get("appProperties", {}).get("vAssetKey")): file
        for file in existing_files
        if file.get("appProperties", {}).get("vManagedBy") == "V" and file.get("appProperties", {}).get("vAssetKey")
    }
    active_keys: set[str] = set()
    uploaded = 0
    reused = remote_count
    skipped = 0
    for entry in entries:
        path = entry["path"]
        key = entry["key"]
        active_keys.add(key)
        stat = path.stat()
        fingerprint = f"{stat.st_mtime_ns}:{stat.st_size}"
        current = existing_by_key.get(key)
        mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        extension = path.suffix.lower() or mimetypes.guess_extension(mime_type) or ".img"
        clean_title = " ".join(str(entry["title"] or "Изображение").split())[:100]
        file_name = f"{clean_title}{extension}" if not clean_title.lower().endswith(extension.lower()) else clean_title
        properties = {"vManagedBy": "V", "vAssetKey": key, "vSourceFingerprint": fingerprint}
        if current and current.get("appProperties", {}).get("vSourceFingerprint") == fingerprint:
            file = current
            reused += 1
        else:
            media = MediaFileUpload(str(path), mimetype=mime_type, resumable=False)
            if current:
                file = drive.files().update(fileId=current["id"], body={"name": file_name, "appProperties": properties}, media_body=media, fields="id,name,appProperties,thumbnailLink,webContentLink").execute()
            else:
                file = drive.files().create(body={"name": file_name, "parents": [folder_id], "appProperties": properties}, media_body=media, fields="id,name,appProperties,thumbnailLink,webContentLink").execute()
            uploaded += 1
        if not file.get("id"):
            skipped += 1
            continue
        permissions = drive.permissions().list(fileId=file["id"], fields="permissions(id,type,role)").execute().get("permissions", [])
        if not any(permission.get("type") == "anyone" and permission.get("role") == "reader" for permission in permissions):
            drive.permissions().create(fileId=file["id"], body={"type": "anyone", "role": "reader"}, fields="id").execute()
        entry["target"]["_sheets_image_url"] = f"https://drive.google.com/uc?export=view&id={file['id']}"
        entry["target"]["_sheets_drive_file_id"] = file["id"]

    deleted = 0
    for file in existing_files:
        properties = file.get("appProperties", {})
        key = str(properties.get("vAssetKey") or "")
        if properties.get("vManagedBy") == "V" and key and key not in active_keys:
            drive.files().delete(fileId=file["id"]).execute()
            deleted += 1
    return {"ok": True, "uploaded": uploaded, "reused": reused, "deleted": deleted, "skipped": skipped}


def structured_text(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    labels = {
        "summary": "Кратко",
        "keyPoints": "Главное",
        "decisions": "Решения",
        "tasks": "Задачи",
        "playbook": "Шпаргалки",
    }
    sections: list[str] = []
    for key, label in labels.items():
        current = value.get(key)
        if not current:
            continue
        if isinstance(current, list):
            lines = []
            for item in current:
                if isinstance(item, dict):
                    if key == "playbook":
                        lines.append(f"• {item.get('cue', '')}: {item.get('response', '')}".strip())
                    elif key == "tasks":
                        lines.append(f"• {item.get('title', '')}".strip())
                    else:
                        lines.append("• " + "; ".join(str(v) for v in item.values() if v))
                else:
                    lines.append(f"• {item}")
            rendered = "\n".join(lines)
        else:
            rendered = str(current)
        if rendered.strip():
            sections.append(f"{label}:\n{rendered.strip()}")
    return "\n\n".join(sections)


def card_body(card: dict[str, Any]) -> str:
    parts: list[str] = []
    content = html_to_text(card.get("content"))
    if content:
        parts.append(content)
    items = card.get("items")
    if isinstance(items, list):
        parts.append("\n".join(f"{'✓' if item.get('checked') else '☐'} {item.get('text', '')}" for item in items if isinstance(item, dict)))
    people = card.get("people")
    if isinstance(people, list):
        parts.append("\n".join(f"• {item.get('name', '')} — {item.get('role', '')}" for item in people if isinstance(item, dict)))
    links = card.get("links")
    if isinstance(links, list):
        parts.append("\n".join(f"↗ {item.get('label') or 'Ссылка'}: {item.get('url', '')}" for item in links if isinstance(item, dict)))
    link_url = str(card.get("linkUrl") or "").strip()
    if link_url:
        parts.append(f"Ссылка: {link_url}")
    if card.get("type") == "image":
        source = str(card.get("src") or "")
        parts.append("Изображение сохранено локально в приложении." if source.startswith("file:") else (f"Изображение: {source}" if source else "Изображение"))
    notes = structured_text(card.get("structured"))
    if notes:
        parts.append(notes)
    transcript = str(card.get("transcript") or "").strip()
    if transcript:
        parts.append(f"Расшифровка:\n{transcript}")
    suggestion = str(card.get("suggestedAnswer") or "").strip()
    if suggestion:
        parts.append(f"AI · вариант ответа:\n{suggestion}")
    knowledge_text = str(card.get("knowledgeText") or "").strip()
    if knowledge_text and not parts:
        parts.append(knowledge_text)
    return compact("\n\n".join(part for part in parts if part.strip()) or "Без дополнительного содержимого")


def card_meta(card: dict[str, Any]) -> str:
    labels = {
        "text": "Заметка",
        "checklist": "Список",
        "links": "Ссылка",
        "image": "Изображение",
        "transcript": "Разговор",
        "people": "Люди",
    }
    pieces = [labels.get(str(card.get("type") or ""), str(card.get("type") or "Карточка"))]
    if card.get("size"):
        pieces.append(f"размер {card['size']}")
    if card.get("duration"):
        pieces.append(f"длительность {card['duration']}")
    if card.get("meetingState"):
        pieces.append(str(card["meetingState"]))
    created = created_label(card.get("createdAt"))
    if created:
        pieces.append(created)
    if card.get("id"):
        pieces.append(f"ID: {card['id']}")
    return " · ".join(pieces)


class SheetLayout:
    def __init__(self, title: str, subtitle: str) -> None:
        self.rows: list[list[str]] = []
        self.blocks: list[dict[str, Any]] = []
        self.formulas: list[dict[str, Any]] = []
        self.add_merged_row(title, "page-title", "#171923", 42)
        self.add_merged_row(subtitle, "page-subtitle", "#F3F4F6", 30)
        self.add_blank(12)

    def add_merged_row(self, text: str, kind: str, color: str, height: int, start_col: int = 0, end_col: int = CARD_COLUMNS) -> int:
        row = len(self.rows) + 1
        values = [""] * CARD_COLUMNS
        values[start_col] = compact(text)
        self.rows.append(values)
        self.blocks.append({"row": row, "kind": kind, "color": color, "height": height, "start_col": start_col, "end_col": end_col})
        return row

    def add_blank(self, height: int = 12) -> None:
        row = len(self.rows) + 1
        self.rows.append([""] * CARD_COLUMNS)
        self.blocks.append({"row": row, "kind": "blank", "height": height, "start_col": 0, "end_col": CARD_COLUMNS})

    def add_space(self, title: str, detail: str = "") -> None:
        label = f"{title}{f'  ·  {detail}' if detail else ''}"
        self.add_merged_row(label, "space", "#2D3748", 34)

    def add_card(self, title: str, body: str, meta: str, accent: str = DEFAULT_ACCENT) -> None:
        accent = hex_color(accent)
        self.add_merged_row(title, "card-title", accent, 32)
        line_count = max(1, body.count("\n") + 1)
        self.add_merged_row(body, "card-body", accent, min(220, max(58, 20 + line_count * 18)))
        self.add_merged_row(meta, "card-meta", accent, 25)
        self.add_blank(11)

    def add_card_grid(self, cards: list[dict[str, str]]) -> None:
        for offset in range(0, len(cards), GALLERY_COLUMNS):
            group = cards[offset:offset + GALLERY_COLUMNS]
            title_row = len(self.rows) + 1
            body_row = title_row + 1
            meta_row = title_row + 2
            self.rows.extend([[""] * CARD_COLUMNS for _ in range(3)])
            estimated_lines = []
            for index, card in enumerate(group):
                start_col = index * (CARD_COLUMN_WIDTH + CARD_COLUMN_GAP)
                end_col = start_col + CARD_COLUMN_WIDTH
                accent = hex_color(card.get("accent") or DEFAULT_ACCENT)
                image_url = str(card.get("image_url") or "").strip()
                body = "" if image_url else compact(card.get("body") or "Без дополнительного содержимого")
                self.rows[title_row - 1][start_col] = compact(card.get("title") or "Без названия")
                self.rows[body_row - 1][start_col] = body
                self.rows[meta_row - 1][start_col] = compact(card.get("meta") or "")
                if image_url:
                    self.formulas.append({"row": body_row, "col": start_col, "formula": image_formula(image_url)})
                    estimated_lines.append(10)
                else:
                    estimated_lines.append(max(body.count("\n") + 1, (len(body) + 41) // 42))
                self.blocks.extend([
                    {"row": title_row, "kind": "card-title", "color": accent, "height": 42, "start_col": start_col, "end_col": end_col},
                    {"row": body_row, "kind": "card-body", "color": accent, "height": 220, "start_col": start_col, "end_col": end_col},
                    {"row": meta_row, "kind": "card-meta", "color": accent, "height": 25, "start_col": start_col, "end_col": end_col},
                ])
            body_height = min(260, max(185, 28 + min(14, max(estimated_lines or [1])) * 17))
            for block in self.blocks:
                if block["row"] == body_row:
                    block["height"] = body_height
            self.add_blank(14)


def build_cards_layout(payload: dict[str, Any]) -> SheetLayout:
    generated = created_label(payload.get("generatedAt")) or datetime.now().strftime("%d.%m.%Y %H:%M")
    workspaces = payload.get("workspaces") if isinstance(payload.get("workspaces"), list) else []
    workspace_title = str(workspaces[0].get("title") or "V") if workspaces and isinstance(workspaces[0], dict) else "V"
    layout = SheetLayout(f"{workspace_title} · КАРТОЧКИ", f"Зеркало карточек приложения · обновлено {generated}")
    if not workspaces:
        layout.add_card("Карточек пока нет", "Добавьте карточку в V — она автоматически появится здесь.", "Автоматическая синхронизация включена", DEFAULT_ACCENT)
        return layout
    for space in workspaces:
        if not isinstance(space, dict):
            continue
        cards = space.get("cards") if isinstance(space.get("cards"), list) else []
        layout.add_space(str(space.get("title") or "Без названия"), f"карточек: {len(cards)}")
        if not cards:
            layout.add_card("Пустое пространство", "В этом пространстве пока нет карточек.", f"ID пространства: {space.get('id', '')}", "#64748B")
            continue
        gallery_cards = []
        for card in cards:
            if not isinstance(card, dict):
                continue
            kicker = str(card.get("kicker") or "Карточка").strip()
            title = str(card.get("title") or "Без названия").strip()
            gallery_cards.append({
                "title": f"{kicker}  ·  {title}",
                "body": card_body(card),
                "meta": card_meta(card),
                "accent": str(card.get("accent") or DEFAULT_ACCENT),
                "image_url": str(card.get("_sheets_image_url") or ""),
            })
        layout.add_card_grid(gallery_cards)
    return layout


def hub_item_body(item: dict[str, Any]) -> str:
    parts = [str(item.get("summary") or "").strip(), str(item.get("text") or "").strip()]
    facts = item.get("facts")
    if isinstance(facts, list) and facts:
        parts.append("Факты:\n" + "\n".join(f"• {value}" for value in facts))
    tags = item.get("tags")
    if isinstance(tags, list) and tags:
        parts.append("Теги: " + ", ".join(str(value) for value in tags))
    if item.get("imageSrc") and not any(parts):
        parts.append("Изображение сохранено локально; текст ещё не извлечён.")
    unique: list[str] = []
    for part in parts:
        if part and part not in unique:
            unique.append(part)
    return compact("\n\n".join(unique) or "Нет извлечённого текста")


def build_hub_layout(payload: dict[str, Any]) -> SheetLayout:
    generated = created_label(payload.get("generatedAt")) or datetime.now().strftime("%d.%m.%Y %H:%M")
    workspaces = payload.get("workspaces") if isinstance(payload.get("workspaces"), list) else []
    workspace_title = str(workspaces[0].get("title") or "V") if workspaces and isinstance(workspaces[0], dict) else "V"
    layout = SheetLayout(f"{workspace_title} · HUB", f"Материалы хаба приложения · обновлено {generated}")
    for space in workspaces:
        if not isinstance(space, dict):
            continue
        knowledge = space.get("knowledge") if isinstance(space.get("knowledge"), dict) else {}
        items = knowledge.get("items") if isinstance(knowledge.get("items"), list) else []
        layout.add_space(str(space.get("title") or "Без названия"), f"материалов: {len(items)}")
        gallery_cards: list[dict[str, str]] = []
        summary = str(knowledge.get("summary") or "").strip()
        if summary:
            gallery_cards.append({"title": "✦ Общая сводка", "body": compact(summary), "meta": f"Ревизия хаба: {knowledge.get('revision', 0)}", "accent": "#7C6FF0"})
        for item in reversed(items):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or ("Изображение" if item.get("type") == "image" else "Заметка"))
            meta = " · ".join(value for value in [str(item.get("type") or "Материал"), created_label(item.get("createdAt")), f"ID: {item.get('id')}" if item.get("id") else ""] if value)
            gallery_cards.append({"title": title, "body": hub_item_body(item), "meta": meta, "accent": "#45A7A0" if item.get("type") == "image" else "#7C6FF0", "image_url": str(item.get("_sheets_image_url") or "")})
        facts = knowledge.get("facts")
        if isinstance(facts, list) and facts:
            gallery_cards.append({"title": "Факты пространства", "body": "\n".join(f"• {value}" for value in facts), "meta": f"Всего фактов: {len(facts)}", "accent": "#2F855A"})
        tags = knowledge.get("tags")
        if isinstance(tags, list) and tags:
            gallery_cards.append({"title": "Теги пространства", "body": "  ·  ".join(str(value) for value in tags), "meta": f"Всего тегов: {len(tags)}", "accent": "#B7791F"})
        playbook = knowledge.get("playbook")
        if isinstance(playbook, list) and playbook:
            body = "\n\n".join(f"{item.get('cue', 'Ситуация')}\n→ {item.get('response', '')}" for item in playbook if isinstance(item, dict))
            gallery_cards.append({"title": "Готовые ответы", "body": compact(body), "meta": f"Всего ответов: {len(playbook)}", "accent": "#C05621"})
        if not summary and not items and not facts and not tags and not playbook:
            gallery_cards.append({"title": "Хаб пока пуст", "body": "Добавьте материал в хаб V — он автоматически появится здесь.", "meta": f"ID пространства: {space.get('id', '')}", "accent": "#64748B"})
        layout.add_card_grid(gallery_cards)
    if not workspaces:
        layout.add_card("Хаб пока пуст", "Добавьте материал в хаб V — он автоматически появится здесь.", "Автоматическая синхронизация включена", "#7C6FF0")
    return layout


def grid_range(sheet_id: int, start_row: int, end_row: int, start_col: int = 0, end_col: int = CARD_COLUMNS) -> dict[str, int]:
    return {
        "sheetId": sheet_id,
        "startRowIndex": start_row - 1,
        "endRowIndex": end_row,
        "startColumnIndex": start_col,
        "endColumnIndex": end_col,
    }


def border(color: str = "#D8DCE6") -> dict[str, Any]:
    return {"style": "SOLID", "colorStyle": {"rgbColor": rgb(color)}}


def row_format(block: dict[str, Any]) -> dict[str, Any]:
    kind = block["kind"]
    color = block.get("color", DEFAULT_ACCENT)
    base: dict[str, Any] = {
        "verticalAlignment": "MIDDLE" if kind in {"page-title", "page-subtitle", "space", "card-title", "card-meta"} else "TOP",
        "wrapStrategy": "WRAP",
        "textFormat": {"fontFamily": "Arial", "fontSize": 10, "foregroundColorStyle": {"rgbColor": rgb("#202533")}},
    }
    if kind == "page-title":
        base.update({"backgroundColorStyle": {"rgbColor": rgb(color)}, "horizontalAlignment": "LEFT"})
        base["textFormat"] = {"fontFamily": "Arial", "fontSize": 18, "bold": True, "foregroundColorStyle": {"rgbColor": rgb("#FFFFFF")}}
    elif kind == "page-subtitle":
        base.update({"backgroundColorStyle": {"rgbColor": rgb(color)}, "horizontalAlignment": "LEFT"})
        base["textFormat"] = {"fontFamily": "Arial", "fontSize": 9, "foregroundColorStyle": {"rgbColor": rgb("#667085")}}
    elif kind == "space":
        base["backgroundColorStyle"] = {"rgbColor": rgb(color)}
        base["textFormat"] = {"fontFamily": "Arial", "fontSize": 12, "bold": True, "foregroundColorStyle": {"rgbColor": rgb("#FFFFFF")}}
    elif kind == "card-title":
        base["backgroundColorStyle"] = {"rgbColor": rgb(color)}
        base["textFormat"] = {"fontFamily": "Arial", "fontSize": 12, "bold": True, "foregroundColorStyle": {"rgbColor": foreground(color)}}
        base["borders"] = {"top": border(color), "left": border(color), "right": border(color)}
    elif kind == "card-body":
        base["backgroundColorStyle"] = {"rgbColor": tint(color)}
        base["borders"] = {"left": border(color), "right": border(color)}
    elif kind == "card-meta":
        base["backgroundColorStyle"] = {"rgbColor": tint(color, 0.94)}
        base["textFormat"] = {"fontFamily": "Arial", "fontSize": 8, "italic": True, "foregroundColorStyle": {"rgbColor": rgb("#667085")}}
        base["borders"] = {"bottom": border(color), "left": border(color), "right": border(color)}
    return base


def get_or_create_sheet(spreadsheet: gspread.Spreadsheet, title: str) -> gspread.Worksheet:
    try:
        return spreadsheet.worksheet(title)
    except WorksheetNotFound:
        return spreadsheet.add_worksheet(title=title, rows=100, cols=CARD_COLUMNS)


def safe_sheet_title(value: Any, fallback: str = "Пространство") -> str:
    title = " ".join(str(value or fallback).replace("'", "’").split()).strip()
    for forbidden in (":", "\\", "/", "?", "*", "[", "]"):
        title = title.replace(forbidden, " ")
    return (" ".join(title.split()) or fallback)[:90]


def unique_sheet_title(base: str, used: set[str]) -> str:
    candidate = base[:100]
    index = 2
    while candidate.casefold() in used:
        suffix = " (V)" if index == 2 else f" (V {index})"
        candidate = f"{base[:100 - len(suffix)]}{suffix}"
        index += 1
    used.add(candidate.casefold())
    return candidate


def worksheet_by_id(spreadsheet: gspread.Spreadsheet, sheet_id: Any) -> gspread.Worksheet | None:
    try:
        return spreadsheet.get_worksheet_by_id(int(sheet_id))
    except (TypeError, ValueError, WorksheetNotFound):
        return None


def read_manifest(spreadsheet: gspread.Spreadsheet) -> tuple[gspread.Worksheet, dict[str, dict[str, Any]]]:
    manifest = get_or_create_sheet(spreadsheet, MANIFEST_SHEET_TITLE)
    manifest.hide()
    values = manifest.get_all_values()
    mapping: dict[str, dict[str, Any]] = {}
    for row in values[1:]:
        padded = row + [""] * (5 - len(row))
        workspace_id, cards_sheet_id, hub_sheet_id, cards_title, hub_title = padded[:5]
        if workspace_id:
            mapping[workspace_id] = {
                "cards_sheet_id": cards_sheet_id,
                "hub_sheet_id": hub_sheet_id,
                "cards_title": cards_title,
                "hub_title": hub_title,
            }
    return manifest, mapping


def write_manifest(manifest: gspread.Worksheet, entries: list[dict[str, Any]]) -> None:
    values = [["workspace_id", "cards_sheet_id", "hub_sheet_id", "cards_title", "hub_title"]]
    values.extend([
        [entry["workspace_id"], str(entry["cards_sheet"].id), str(entry["hub_sheet"].id), entry["cards_title"], entry["hub_title"]]
        for entry in entries
    ])
    if manifest.row_count < len(values) or manifest.col_count < 5:
        manifest.resize(rows=max(manifest.row_count, len(values)), cols=max(manifest.col_count, 5))
    manifest.clear()
    manifest.update(range_name=f"A1:E{len(values)}", values=values, value_input_option="RAW")
    manifest.hide()


def sync_workspace_sheets(spreadsheet: gspread.Spreadsheet, payload: dict[str, Any]) -> dict[str, Any]:
    workspaces = [space for space in payload.get("workspaces", []) if isinstance(space, dict) and space.get("id")]
    manifest, saved_mapping = read_manifest(spreadsheet)
    worksheets = spreadsheet.worksheets()
    by_title = {worksheet.title: worksheet for worksheet in worksheets}

    # Migrate the prototype V / V hub pair to the Antischool workspace on the first real sync.
    if not saved_mapping and workspaces:
        migration_space = next((space for space in workspaces if "анти" in str(space.get("title") or "").casefold()), workspaces[0])
        legacy_cards = by_title.get("V")
        legacy_hub = by_title.get("V hub")
        if legacy_cards or legacy_hub:
            saved_mapping[str(migration_space["id"])] = {
                "cards_sheet_id": str(legacy_cards.id) if legacy_cards else "",
                "hub_sheet_id": str(legacy_hub.id) if legacy_hub else "",
                "cards_title": legacy_cards.title if legacy_cards else "",
                "hub_title": legacy_hub.title if legacy_hub else "",
            }

    managed_ids = {
        int(sheet_id)
        for entry in saved_mapping.values()
        for sheet_id in (entry.get("cards_sheet_id"), entry.get("hub_sheet_id"))
        if str(sheet_id).isdigit()
    }
    used_titles = {
        worksheet.title.casefold()
        for worksheet in worksheets
        if worksheet.id not in managed_ids and worksheet.id != manifest.id and worksheet.title not in {"V", "V hub"}
    }

    entries: list[dict[str, Any]] = []
    for space in workspaces:
        workspace_id = str(space["id"])
        base = safe_sheet_title(space.get("title"))
        cards_title = unique_sheet_title(base, used_titles)
        hub_title = unique_sheet_title(f"{base} hub", used_titles)
        saved = saved_mapping.get(workspace_id, {})
        entries.append({
            "workspace_id": workspace_id,
            "space": space,
            "cards_title": cards_title,
            "hub_title": hub_title,
            "cards_sheet": worksheet_by_id(spreadsheet, saved.get("cards_sheet_id")),
            "hub_sheet": worksheet_by_id(spreadsheet, saved.get("hub_sheet_id")),
        })

    current_ids = {entry["workspace_id"] for entry in entries}
    current_sheet_ids = {worksheet.id for entry in entries for worksheet in (entry["cards_sheet"], entry["hub_sheet"]) if worksheet}
    for workspace_id, saved in saved_mapping.items():
        if workspace_id in current_ids:
            continue
        for sheet_id in (saved.get("cards_sheet_id"), saved.get("hub_sheet_id")):
            worksheet = worksheet_by_id(spreadsheet, sheet_id)
            if worksheet and worksheet.id not in current_sheet_ids and worksheet.id != manifest.id:
                spreadsheet.del_worksheet(worksheet)

    # Temporary names make workspace-name swaps safe.
    temporary_titles = {worksheet.title.casefold() for worksheet in spreadsheet.worksheets()}
    for entry in entries:
        for key, desired in (("cards_sheet", entry["cards_title"]), ("hub_sheet", entry["hub_title"])):
            worksheet = entry[key]
            if worksheet and worksheet.title != desired:
                temporary = unique_sheet_title(f"_V temporary {worksheet.id}", temporary_titles)
                worksheet.update_title(temporary)

    for entry in entries:
        cards_sheet = entry["cards_sheet"]
        hub_sheet = entry["hub_sheet"]
        if cards_sheet is None:
            cards_sheet = spreadsheet.add_worksheet(title=entry["cards_title"], rows=100, cols=CARD_COLUMNS)
            entry["cards_sheet"] = cards_sheet
        elif cards_sheet.title != entry["cards_title"]:
            cards_sheet.update_title(entry["cards_title"])
        if hub_sheet is None:
            hub_sheet = spreadsheet.add_worksheet(title=entry["hub_title"], rows=100, cols=CARD_COLUMNS)
            entry["hub_sheet"] = hub_sheet
        elif hub_sheet.title != entry["hub_title"]:
            hub_sheet.update_title(entry["hub_title"])

        workspace_payload = {"generatedAt": payload.get("generatedAt"), "workspaces": [entry["space"]]}
        write_layout(spreadsheet, cards_sheet, build_cards_layout(workspace_payload))
        write_layout(spreadsheet, hub_sheet, build_hub_layout(workspace_payload))

    write_manifest(manifest, entries)
    managed_sheet_ids = {worksheet.id for entry in entries for worksheet in (entry["cards_sheet"], entry["hub_sheet"])}
    unmanaged = [worksheet for worksheet in spreadsheet.worksheets() if worksheet.id not in managed_sheet_ids and worksheet.id != manifest.id]
    ordered = [*unmanaged, *(worksheet for entry in entries for worksheet in (entry["cards_sheet"], entry["hub_sheet"])), manifest]
    if [worksheet.id for worksheet in spreadsheet.worksheets()] != [worksheet.id for worksheet in ordered]:
        spreadsheet.reorder_worksheets(ordered)
    return {
        "ok": True,
        "workspaces": len(entries),
        "cards": sum(len(entry["space"].get("cards", [])) for entry in entries),
        "hubItems": sum(len((entry["space"].get("knowledge") or {}).get("items", [])) for entry in entries),
        "sheets": [title for entry in entries for title in (entry["cards_title"], entry["hub_title"])],
    }


def write_layout(spreadsheet: gspread.Spreadsheet, worksheet: gspread.Worksheet, layout: SheetLayout) -> None:
    needed_rows = max(20, len(layout.rows))
    existing_rows = worksheet.row_count
    existing_cols = worksheet.col_count
    spreadsheet.batch_update({"requests": [{"unmergeCells": {"range": {
        "sheetId": worksheet.id,
        "startRowIndex": 0,
        "endRowIndex": existing_rows,
        "startColumnIndex": 0,
        "endColumnIndex": existing_cols,
    }}}]})
    if existing_rows < needed_rows or existing_cols < CARD_COLUMNS:
        worksheet.resize(rows=max(existing_rows, needed_rows), cols=max(existing_cols, CARD_COLUMNS))
    worksheet.clear()
    worksheet.update(range_name=f"A1:X{len(layout.rows)}", values=layout.rows, value_input_option="RAW")

    requests: list[dict[str, Any]] = [
        {
            "repeatCell": {
                "range": grid_range(worksheet.id, 1, len(layout.rows)),
                "cell": {"userEnteredFormat": {
                    "backgroundColorStyle": {"rgbColor": rgb("#FFFFFF")},
                    "verticalAlignment": "TOP",
                    "wrapStrategy": "WRAP",
                    "textFormat": {"fontFamily": "Arial", "fontSize": 10, "foregroundColorStyle": {"rgbColor": rgb("#202533")}},
                }},
                "fields": "userEnteredFormat",
            }
        },
        {"updateSheetProperties": {"properties": {"sheetId": worksheet.id, "gridProperties": {"frozenRowCount": 2, "hideGridlines": True}}, "fields": "gridProperties.frozenRowCount,gridProperties.hideGridlines"}},
    ]
    for index in range(CARD_COLUMNS):
        spacer = index in {4, 9, 14, 19}
        requests.append({"updateDimensionProperties": {"range": {"sheetId": worksheet.id, "dimension": "COLUMNS", "startIndex": index, "endIndex": index + 1}, "properties": {"pixelSize": 16 if spacer else 88}, "fields": "pixelSize"}})
    row_heights: dict[int, int] = {}
    for block in layout.blocks:
        row = block["row"]
        start_col = block.get("start_col", 0)
        end_col = block.get("end_col", CARD_COLUMNS)
        row_heights[row] = max(row_heights.get(row, 0), block["height"])
        requests.extend([
            {"mergeCells": {"range": grid_range(worksheet.id, row, row, start_col, end_col), "mergeType": "MERGE_ALL"}},
            {"repeatCell": {"range": grid_range(worksheet.id, row, row, start_col, end_col), "cell": {"userEnteredFormat": row_format(block)}, "fields": "userEnteredFormat"}},
        ])
    for row, height in row_heights.items():
        requests.append({"updateDimensionProperties": {"range": {"sheetId": worksheet.id, "dimension": "ROWS", "startIndex": row - 1, "endIndex": row}, "properties": {"pixelSize": height}, "fields": "pixelSize"}})
    for formula in layout.formulas:
        requests.append({
            "updateCells": {
                "range": {
                    "sheetId": worksheet.id,
                    "startRowIndex": formula["row"] - 1,
                    "endRowIndex": formula["row"],
                    "startColumnIndex": formula["col"],
                    "endColumnIndex": formula["col"] + 1,
                },
                "rows": [{"values": [{"userEnteredValue": {"formulaValue": formula["formula"]}}]}],
                "fields": "userEnteredValue",
            }
        })
    spreadsheet.batch_update({"requests": requests})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--credentials", required=True)
    parser.add_argument("--spreadsheet-id", required=True)
    parser.add_argument("--drive-oauth-client", default="")
    parser.add_argument("--drive-token", default="")
    parser.add_argument("--share-images-by-link", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    if args.dry_run:
        sheets = []
        cards_rows = 0
        hub_rows = 0
        for space in [space for space in payload.get("workspaces", []) if isinstance(space, dict)]:
            workspace_payload = {"generatedAt": payload.get("generatedAt"), "workspaces": [space]}
            cards_rows += len(build_cards_layout(workspace_payload).rows)
            hub_rows += len(build_hub_layout(workspace_payload).rows)
            base = safe_sheet_title(space.get("title"))
            sheets.extend([base, f"{base} hub"])
        print(json.dumps({"ok": True, "workspaces": len(sheets) // 2, "cardsRows": cards_rows, "hubRows": hub_rows, "sheets": sheets}, ensure_ascii=False))
        return 0

    client = gspread.service_account(filename=args.credentials)
    spreadsheet = client.open_by_key(args.spreadsheet_id)
    image_result: dict[str, Any] = {"ok": True, "reason": "not_configured", "uploaded": 0, "reused": 0, "deleted": 0, "skipped": 0}
    if args.drive_oauth_client and args.drive_token:
        try:
            image_result = prepare_image_assets(payload, args.drive_oauth_client, args.drive_token, args.share_images_by_link)
        except Exception as error:
            image_result = {
                "ok": False,
                "reason": "image_sync_failed",
                "detail": type(error).__name__,
                "uploaded": 0,
                "reused": 0,
                "deleted": 0,
                "skipped": 0,
            }
    result = sync_workspace_sheets(spreadsheet, payload)
    result["images"] = image_result
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
