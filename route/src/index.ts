// HELPERS
import ch from '@harrypoggers/color';

// MODULES
import express from 'express';
namespace Route {
    namespace Status {
        export type Success = 200 | 201 | 302;
        export type Failed = 400 | 401 | 403 | 404 | 409 | 500;
        export type All = Success | Failed
    }
    export type Success<T = undefined> = { status: Status.Success, result: { message: string, data: T, subResponse?: Failed } };
    export type Failed = { status: Status.Failed, result: { message: string, subResponse?: Failed } };
    export type Response<T = undefined> = Success<T> | Failed;
    export type PResponse<T = undefined> = Promise<Response<T>>;

    export type EExpress = express.Express;
    export type ERouter = express.Router;
    export type ERequest = express.Request & { user?: any };
    export type EResponse = express.Response;
    export type ENextFunction = express.NextFunction;
    export type Router = (router: ERouter) => void
    export type Controller = (req: ERequest, res: EResponse) => void;
    export type Middleware = (req: ERequest, res: EResponse, next: ENextFunction) => void;
    export type ErrorHandler = (err: any, req: ERequest, res: EResponse, next: ENextFunction) => void;

    export function asyncHandler(callback: (req: ERequest, res: EResponse, next: ENextFunction) => Promise<void>): Middleware {
        return async (req, res, next) => {
            try {
                await callback(req, res, next);
            } catch (error: any) {
                const statusCode = res.statusCode !== 200 ? res.statusCode ?? 500 : 500;
                res.status(statusCode).json({
                    error: error,
                    message: error.message
                });
            }
        }
    }

    export function add(app: express.Express | undefined, path: string, route: Router) {
        if (!app) {
            console.log(ch.red('ROUTE ADD ERROR:'), 'Unable to create route. Express app is not initialized');
            return;
        }

        const router = express.Router();
        route(router);
        app.use(path, router);
    }

    export function isSuccess(status: Status.All): status is Status.Success;
    export function isSuccess<T>(response: Response<T>): response is Success<T>;
    export function isSuccess<T>(param: number | Response<T>): boolean {
        if (typeof param === "number") return [200, 201, 302].includes(param);
        return isSuccess(param.status);
    }
    export function createResponse(status: Status.Failed, message: string, subResponse?: Failed): Failed;
    export function createResponse<T = undefined>(status: Status.Success, message: string, data: T, subResponse?: Failed): Success<T>;
    export function createResponse<T = undefined>(status: Status.All, message: string, param1: T | Failed, param2?: Failed): Response<T> {
        if (isSuccess(status)) return { status, result: { message, data: param1 as T, subResponse: param2 } };
        return { status, result: { message, subResponse: param1 as Failed } };
    }
    export function createMessage(status: Status.Failed, message: string, subResponse?: Failed): Failed
    export function createMessage(status: Status.Success, message: string, subResponse?: Failed): Success<undefined>
    export function createMessage(status: Status.All, message: string, subResponse?: Failed): Response<undefined> {
        if (!isSuccess(status)) {
            console.log(ch.red('ROUTE ERROR:'), message);
            return createResponse(status, message, subResponse);
        }
        if (status === 302) console.log(ch.yellow('ROUTE REDIRECT:'), message);
        return createResponse(status, message, undefined, subResponse);
    }
    export function mapResponseData<T, N>(response: Success<T>, callback: (data: T) => N): Success<N> {
        return {
            status: response.status,
            result: {
                message: response.result.message,
                data: callback(response.result.data),
                subResponse: response.result.subResponse
            }
        };
    }
    export const errorHandler: ErrorHandler = (err, req, res, next) => {
        const statusCode = res.statusCode !== 200 ? res.statusCode ?? 500 : 500;
        res.status(statusCode).json({
            error: err,
            message: err.message
        });
    }
}

export default Route;
