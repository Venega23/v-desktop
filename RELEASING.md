# Выпуск обновления V

Этот файл нужен в том числе для следующих чатов Codex: канал обновлений уже настроен на публичный GitHub-репозиторий `Venega23/v-desktop`.

1. Завершить изменения и выполнить:

   ```powershell
   npm run check
   npm run test:smoke
   ```

2. Поднять версию без автоматического тега, например:

   ```powershell
   npm version patch --no-git-tag-version
   ```

3. Зафиксировать и отправить код:

   ```powershell
   git add -A
   git commit -m "Release vX.Y.Z"
   git push origin main
   ```

4. Создать и отправить тег той же версии:

   ```powershell
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

Workflow `.github/workflows/release.yml` сам выполнит тесты, соберёт Windows-файлы и опубликует GitHub Release. Для автообновления обязательны как минимум:

- `latest.yml` с версией, размером и SHA-512;
- `V-Setup-X.Y.Z-x64.exe`;
- `V-Setup-X.Y.Z-x64.exe.blockmap`.

`V.exe` публикуется дополнительно для portable-пользователей. Не удаляйте `latest.yml` и blockmap из релиза. Если позже появится сертификат подписи кода, его следует подключить к GitHub Actions через Secrets; текущую SHA-512-проверку отключать нельзя.
