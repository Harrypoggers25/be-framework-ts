// MODULES
import ch from '@harrypoggers/color';
import cors from 'cors';
import express from 'express';
import http from 'http';

const app = express();
const server = http.createServer(app);

interface AppListenOptions {
    version: string,
    port?: string | number,
    corsOrigin?: string,
    beforeListen?: (app: express.Express) => Promise<void>
    callback?: (app: express.Express, server: http.Server) => Promise<void>,
}
namespace App {
    export async function listen(options: AppListenOptions) {
        options = {
            version: options.version,
            port: options.port ?? 3000,
            corsOrigin: options?.corsOrigin,
            beforeListen: options?.beforeListen ?? (async () => { }),
            callback: options?.callback ?? (async () => { })
        };

        if (options.corsOrigin) {
            app.use(cors({
                origin: options.corsOrigin,
                methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
                credentials: true
            }))
        }
        app.use(express.json());

        await options.beforeListen?.(app)!;

        const port = options.port!;
        server.listen(port, async () => {
            console.log('Server running on port', ch.yellow(port));
            console.log(`Press ${ch.cyan('[CTRL + C]')} to gracefully stop server`);
            console.log(`Running version ${ch.green(options.version!)}\n`);

            await options.callback?.(app, server)!;
        });
    }
}

export default App;
