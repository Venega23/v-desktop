const question = document.getElementById('question');
const answer = document.getElementById('answer');
const pause = document.getElementById('pause');

window.sloy?.onAnswerPopup?.(payload => {
  question.textContent = payload?.question ? `На вопрос: ${payload.question}` : 'Новый вариант ответа';
  answer.textContent = payload?.suggestion || 'Ответ пока не получен.';
  document.body.classList.add('ready');
});

window.sloy?.onAnswerPauseState?.(state => {
  const paused = Boolean(state?.paused);
  pause.classList.toggle('active', paused);
  pause.setAttribute('aria-pressed', String(paused));
  pause.textContent = paused ? 'Продолжить · Caps Lock' : 'Заморозить · Caps Lock';
  pause.title = state?.shortcutAvailable === false ? 'Глобальный Caps Lock недоступен — используйте эту кнопку' : '';
});

document.getElementById('close').addEventListener('click', () => window.sloy?.dismissAnswerPopup?.());
document.getElementById('open').addEventListener('click', () => window.sloy?.openMainFromAnswer?.());
pause.addEventListener('click', () => window.sloy?.toggleAnswerPause?.());
