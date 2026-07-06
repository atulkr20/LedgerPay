import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';

export function setupTerminal(server: http.Server) {

    const wss = new WebSocketServer({ server });

    wss.on('connection', function(ws) {
        console.log('[Terminal] New browser session connected');

        // Spawn the CLI
        const shell = pty.spawn('node', ['-r', 'ts-node/register', 'src/cli/index.ts'], {
            name: 'xterm-color',
            cols: 220,
            rows: 50,
            cwd: process.cwd(),
            env: process.env as { [key: string]: string }
        });

        // When the CLI prints something, send it to the browser
        shell.onData(function(data) {
            ws.send(data);
        });

        // When browser sends a keypress, forward it to the CLI
        ws.on('message', function(data) {
            shell.write(data.toString());
        });

        // When browser disconnects, kill the CLI process
        ws.on('close', function() {
            console.log('[Terminal] Browser disconnected, killing shell');
            shell.kill();
        });

    }); 

    // Serve the html page when someone visits /terminal
    // This return is OUTSIDE the connection callback
    return function terminalPage(req: any, res: any) {
        const filePath = path.join(__dirname, 'public', 'index.html');
        const html = fs.readFileSync(filePath, 'utf-8');
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    };

}
