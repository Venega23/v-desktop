let meeting = null;
let activeTab = 'now';
const content = document.getElementById('content');
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
const list = (values, ordered = false) => values?.length ? `<${ordered ? 'ol' : 'ul'}>${values.map(value => `<li>${escapeHtml(typeof value === 'string' ? value : value.title || value.summary || '')}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>` : '<p class="empty">Пока ничего не найдено.</p>';

function render() {
  if (!meeting) return;
  const finalized = meeting.state === 'finalized';
  const pausing = meeting.state === 'pausing';
  document.getElementById('title').textContent = meeting.title;
  const labels = { active:'● Идёт запись', pausing:'Сохраняю запись…', paused:'Ⅱ На паузе', finalized:'✓ Завершена' };
  document.getElementById('state').textContent = `${labels[meeting.state] || meeting.state} · ${meeting.duration}`;
  const pauseButton = document.getElementById('pause');
  const finishButton = document.getElementById('finish');
  pauseButton.hidden = finalized;
  pauseButton.textContent = meeting.state === 'paused' ? 'Продолжить' : 'Пауза';
  pauseButton.disabled = pausing;
  finishButton.textContent = finalized ? 'Закрыть окно' : pausing ? 'Завершить после сохранения' : 'Завершить встречу';
  finishButton.disabled = false;
  finishButton.classList.toggle('danger', !finalized);
  const progress = document.getElementById('progress');
  const progressText = meeting.progress?.message || ({ transcribing:'AI расшифровывает аудио…', structuring:'AI собирает конспект…', saving:'Сохраняю запись…' }[meeting.processing] || '');
  progress.textContent = meeting.progress?.total ? `${progressText} · ${meeting.progress.current} из ${meeting.progress.total}` : progressText;
  progress.classList.toggle('visible', Boolean(progressText));
  if (activeTab === 'now') content.innerHTML = `${meeting.suggestion ? `<div class="suggestion"><small>AI · варианты ответа${meeting.suggestedFor ? ` · ${escapeHtml(meeting.suggestedFor)}` : ''}</small><p>${escapeHtml(meeting.suggestion)}</p></div>` : ''}<div class="hero"><small>Краткая выжимка</small><p>${escapeHtml(meeting.summary || 'AI слушает разговор и собирает контекст.')}</p></div>`;
  if (activeTab === 'summary') content.innerHTML = `<div class="hero"><small>Краткая выжимка</small><p>${escapeHtml(meeting.summary || 'Конспект ещё формируется.')}</p></div>${meeting.topics?.length ? `<div class="section"><h3>Темы и детали</h3>${meeting.topics.map(topic => `<p class="topic"><b>${escapeHtml(topic.title)}</b><span>${escapeHtml(topic.summary)}</span></p>`).join('')}</div>` : ''}${meeting.decisions?.length ? `<div class="section"><h3>Решения</h3>${list(meeting.decisions)}</div>` : ''}${meeting.tasks?.length ? `<div class="section"><h3>Что сделать</h3>${list(meeting.tasks)}</div>` : ''}`;
  if (activeTab === 'important') content.innerHTML = `<div class="section"><h3>Самое важное · ${meeting.keyPoints?.length || 0}</h3>${list(meeting.keyPoints, true)}</div>`;
  if (activeTab === 'cheats') content.innerHTML = meeting.playbook?.length ? meeting.playbook.map(item => `<div class="section"><h3>${escapeHtml(item.cue)}</h3><p>${escapeHtml(item.response)}</p></div>`).join('') : '<p class="empty">Шпаргалки ещё не сформированы.</p>';
  if (activeTab === 'transcript') content.innerHTML = meeting.transcript ? `<div class="transcript">${escapeHtml(meeting.transcript)}</div>` : '<p class="empty">Расшифровка появится после первых реплик.</p>';
}

window.sloy?.onMeetingWindowUpdate?.(payload => { meeting = payload; render(); });
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { activeTab = button.dataset.tab; document.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item === button)); render(); }));
document.getElementById('pause').addEventListener('click', () => {
  if (!meeting?.cardId) return;
  const action = meeting.state === 'paused' ? 'resume' : 'pause';
  if (action === 'pause') { meeting = { ...meeting, state:'pausing' }; render(); }
  window.sloy?.sendMeetingWindowAction?.(action, meeting.cardId);
});
document.getElementById('finish').addEventListener('click', () => {
  if (!meeting?.cardId) return;
  if (meeting.state === 'finalized') {
    window.sloy?.sendMeetingWindowAction?.('hide', meeting.cardId);
    return;
  }
  meeting = { ...meeting, state:'pausing' };
  render();
  window.sloy?.sendMeetingWindowAction?.('finish', meeting.cardId);
});
document.getElementById('copy-content').addEventListener('click', async event => {
  const text = content.innerText.trim();
  if (!text) return;
  const result = await window.sloy?.copyText?.(text);
  if (!result?.ok) return;
  const button = event.currentTarget;
  button.textContent = 'Скопировано ✓';
  setTimeout(() => { if (button.isConnected) button.textContent = 'Копировать текст'; }, 1800);
});
document.getElementById('open-main').addEventListener('click', () => window.sloy?.sendMeetingWindowAction?.('open-main', meeting?.cardId));
document.getElementById('minimize').addEventListener('click', () => window.sloy?.sendMeetingWindowAction?.('minimize', meeting?.cardId));
document.getElementById('close').addEventListener('click', () => window.sloy?.sendMeetingWindowAction?.('hide', meeting?.cardId));
