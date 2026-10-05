const { subscribe } = require('../utils/events');

/** Server-Sent Events: pushes change notifications so open browser tabs refresh without polling. */
function stream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: {}\n\n`);
  const unsubscribe = subscribe(req.user.id, (evt) => res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`));
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
}

module.exports = { stream };
