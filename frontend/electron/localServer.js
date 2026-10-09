'use strict';
function listenLoopback(server, preferredPort = 47821) {
  return new Promise((resolve, reject) => {
    let retried = false;
    const cleanup = () => { server.removeListener('error', onError); server.removeListener('listening', onListening); };
    const onListening = () => { cleanup(); resolve(server.address().port); };
    const onError = error => {
      if (!retried && preferredPort !== 0 && ['EADDRINUSE', 'EACCES'].includes(error.code)) {
        retried = true;
        server.listen(0, '127.0.0.1');
      } else { cleanup(); reject(error); }
    };
    server.on('error', onError);
    server.once('listening', onListening);
    server.listen(preferredPort, '127.0.0.1');
  });
}
module.exports = { listenLoopback };
