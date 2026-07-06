import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';

export function setupTerminal(server: http.Server) {

    const wss = new WebSocketServer({ server });

    wss.on('connection', function(ws) {
        console.log('[Terminal] New browser session connected');

        // Spawn the CLI using Node's built-in child_process
        const shell = spawn('node', ['-r', 'ts-node/register', 'cli/index.ts'], {
            cwd: process.cwd(),
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // When the CLI prints something, send it to the browser
        shell.stdout.on('data', function(data: Buffer) {
            ws.send(data.toString());
        });

        // Also send stderr (errors) to the browser so you can see them
        shell.stderr.on('data', function(data: Buffer) {
            const msg = data.toString();
            console.log('[CLI stderr]', msg);   // ← print to server console too
            ws.send(msg);
        });

        // When browser sends a keypress, forward it to the CLI
        ws.on('message', function(data) {
            shell.stdin.write(data.toString());
        });

        // When browser disconnects, kill the CLI process
        ws.on('close', function() {
            console.log('[Terminal] Browser disconnected, killing shell');
            shell.kill();
        });

        // If the CLI exits on its own, log why
        shell.on('exit', function(code, signal) {
            console.log('[CLI exited] code:', code, ' signal:', signal);
            ws.close();
        });

    });

    // Serve the html page when someone visits /terminal
    return function terminalPage(req: any, res: any) {
        const filePath = path.join(__dirname, 'public', 'index.html');
        const html = fs.readFileSync(filePath, 'utf-8');
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    };

}


