const http = require('node:http');
const WebSocket = require('ws');

const port = Number(process.env.SLOY_DEBUG_PORT || 9222);
const requestedMeetingTab = process.argv.includes('--meeting-cheats') ? 'cheats' : process.argv.includes('--meeting-summary') ? 'summary' : '';
const request = http.get(`http://127.0.0.1:${port}/json/list`, response => {
  let data = '';
  response.setEncoding('utf8');
  response.on('data', chunk => { data += chunk; });
  response.on('end', () => {
    let targets;
    try { targets = JSON.parse(data); }
    catch { console.error('Не удалось прочитать список renderer-процессов'); process.exitCode = 1; return; }
    const page = targets.find(target => target.type === 'page' && target.url.includes('index.html'));
    if (!page?.webSocketDebuggerUrl) { console.error('Renderer Слоя не найден'); process.exitCode = 1; return; }

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timeout = setTimeout(() => { console.error('Renderer не ответил вовремя'); socket.terminate(); process.exitCode = 1; }, 5000);
    socket.on('open', () => {
      socket.send(JSON.stringify({ id:1, method:'Runtime.enable' }));
      if (requestedMeetingTab) {
        socket.send(JSON.stringify({ id:3, method:'Runtime.evaluate', params:{ expression:`(() => { const space = workspaces.find(item => item.cards.some(card => card.type === 'transcript' && card.structured?.keyPoints?.length)); if (!space) return false; activeSpaceId = space.id; cards = space.cards; const meeting = cards.find(card => card.type === 'transcript' && card.structured?.keyPoints?.length); meetingTabs.set(meeting.id, ${JSON.stringify(requestedMeetingTab)}); render(); return true; })()` } }));
      }
      socket.send(JSON.stringify({
        id:2,
        method:'Runtime.evaluate',
        params:{
          returnByValue:true,
          expression:'({ title:document.title, readyState:document.readyState, appReady:document.body.dataset.appReady === "true", cards:document.querySelectorAll(".card").length, dialogs:document.querySelectorAll("dialog").length, recording:document.body.classList.contains("recording-active"), topBarHidden:getComputedStyle(document.querySelector(".workspace-viewbar")).display === "none", meetingUi:{ cards:document.querySelectorAll(".transcript-card").length, important:document.querySelectorAll(".recap-important").length, boardActions:document.querySelectorAll(".open-board-ai").length, boardComposers:document.querySelectorAll(".board-ai-composer").length }, spaces:typeof workspaces === "undefined" ? [] : workspaces.map(space => ({ id:space.id, cards:space.cards.length, meetings:space.cards.filter(card => card.type === "transcript").map(card => ({ id:card.id, questions:card.structured?.questions?.length || 0, playbook:card.structured?.playbook?.length || 0 })) })) })'
        }
      }));
    });
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails || {};
        const exception = details.exception || {};
        console.error('Renderer exception:', exception.description || exception.value || details.text || 'unknown');
        if (details.url || Number.isInteger(details.lineNumber)) {
          console.error(`  at ${details.url || 'renderer'}:${Number(details.lineNumber || 0) + 1}:${Number(details.columnNumber || 0) + 1}`);
        }
      }
      if (message.id !== 2) return;
      clearTimeout(timeout);
      console.log(JSON.stringify(message.result?.result?.value || {}, null, 2));
      socket.close();
    });
    socket.on('error', error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
  });
});

request.setTimeout(5000, () => request.destroy(new Error('DevTools connection timeout')));
request.on('error', error => { console.error(`Не удалось подключиться к порту ${port}: ${error.message}`); process.exitCode = 1; });
