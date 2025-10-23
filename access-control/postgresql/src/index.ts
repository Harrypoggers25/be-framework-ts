// MODULES
import express from 'express';

// HELPERS
import Db, { DataTypes, Pool } from '@harrypoggers/db-postgresql';
import Route from '@harrypoggers/route';

type ERequest = express.Request & { user?: any };
type EResponse = express.Response;
type ENextFunction = express.NextFunction;
type EMiddleware = (req: ERequest, res: EResponse, next: ENextFunction) => void;

namespace AccessControl {
    interface RoleBaseOptions {
        tableName?: string;
        setRolesHandler?: (transaction?: Pool.Transaction) => Promise<Array<string>>;
        setRoutesHandler?: (app: express.Express) => Promise<Array<string>>;
        ignoreRoutes?: Array<string>;
    };
    interface RoleBaseSyncOptions {
        alter?: boolean;
        setRolesHandler?: (transaction?: Pool.Transaction) => Promise<Array<string>>;
        setRoutesHandler?: (app: express.Express) => Promise<Array<string>>;
        transaction?: Pool.Transaction;
    };
    export class RoleBase {
        private mappedRole: (req: ERequest) => string;
        private setRolesHandler: (transaction?: Pool.Transaction) => Promise<Array<string>>;
        private setRoutesHandler: (app: express.Express) => Promise<Array<string>>;
        private ignoreRoutes: Array<string>;
        private db: Db.Db;
        private model;

        constructor(db: Db.Db, roleFromReq: (req: ERequest) => string, options?: RoleBaseOptions) {
            options = {
                tableName: options?.tableName ?? 'rbac_table',
                setRolesHandler: options?.setRolesHandler ?? (async () => []),
                setRoutesHandler: options?.setRoutesHandler ?? (async () => []),
                ignoreRoutes: options?.ignoreRoutes ?? []
            }

            this.mappedRole = roleFromReq;
            this.setRolesHandler = options.setRolesHandler!;
            this.setRoutesHandler = options.setRoutesHandler!;
            this.ignoreRoutes = options.ignoreRoutes!;
            this.db = db;

            const tableName = options.tableName!;

            this.model = db.define(tableName, {
                rbac_id: { type: DataTypes.SERIAL, allowNull: false, primaryKey: true },
                role_name: { type: DataTypes.TEXT, allowNull: false },
                route: { type: DataTypes.TEXT, allowNull: false },
                can_post: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
                can_get: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
                can_patch: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
                can_put: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
                can_delete: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
            });
        }
        public async sync(app: express.Express, options?: RoleBaseSyncOptions) {
            options = {
                alter: options?.alter ?? false,
                setRolesHandler: options?.setRolesHandler ?? this.setRolesHandler,
                setRoutesHandler: options?.setRoutesHandler ?? this.setRoutesHandler,
                transaction: options?.transaction ?? await this.db.transaction({ rollbackOnError: true })
            }

            if (!options.alter) return;

            const transaction = options.transaction!;
            const roles = await options.setRolesHandler?.(transaction);
            const routes = await options.setRoutesHandler?.(app)!;
            for (const role_name of roles!) {
                for (const route of routes) {
                    if (this.ignoreRoutes.map(route => route.trim()).includes(route)) continue;

                    const response = await this.model.create({ role_name, route }, { transaction });
                    if (!response) return;
                }
            }
            if (!options.transaction!) transaction.commit();
        }
        public single(): EMiddleware {
            return Route.asyncHandler(async (req, res, next) => {
                const role = this.mappedRole(req);
                const route = `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}`;
                const response = await this.model.find({ where: { role_name: role, route } });
                if (!response || !response.length) {
                    res.status(403);
                    throw new Error('Forbidden Access. Failed to find rbac record');
                }

                const rbac = response[0];
                const method = req.method.toUpperCase();
                if (
                    (method === 'POST' && !rbac.can_post) ||
                    (method === 'GET' && !rbac.can_get) ||
                    (method === 'PATCH' && !rbac.can_patch) ||
                    (method === 'PUT' && !rbac.can_put) ||
                    (method === 'DELETE' && !rbac.can_delete)
                ) {
                    res.status(403);
                    throw new Error(`Forbidden Access. User with role '${role}' is not allowed to access this route`);
                }

                next();
            });
        }
    }

    interface AttributeBaseOptions {
        tableName?: string;
    };
    interface AttributeBaseSyncOptions {
        alter?: boolean;
        transaction?: Pool.Transaction;
    }
    export class AttributeBase {
        private db: Db.Db;
        private model;
        private attributesHandlers: Record<string, Record<string, (req: ERequest) => Promise<boolean>>>;

        constructor(db: Db.Db, options?: AttributeBaseOptions) {
            options = {
                tableName: options?.tableName ?? 'abac_table',
            }

            this.db = db;

            const tableName = options.tableName!;

            this.model = this.db.define(tableName, {
                abac_id: { type: DataTypes.SERIAL, allowNull: false, primaryKey: true },
                attribute_name: { type: DataTypes.TEXT, allowNull: false },
                route: { type: DataTypes.TEXT, allowNull: false },
                check_post: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
                check_get: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
                check_patch: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
                check_put: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
                check_delete: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
            });
            this.attributesHandlers = {};
        }
        public addAttribute(route: string, attributeName: string, attributeHandler: (req: ERequest) => Promise<boolean>) {
            if (!this.attributesHandlers[route]) this.attributesHandlers[route] = {};
            if (this.attributesHandlers[route][attributeName]) throw new Error(
                `Failed to add attribute '${attributeName}' for route '${route}'. Route already exists`
            );

            this.attributesHandlers[route][attributeName] = attributeHandler;
        }
        public async sync(options?: AttributeBaseSyncOptions) {
            options = {
                alter: options?.alter ?? false,
                transaction: options?.transaction ?? await this.db.transaction({ rollbackOnError: true })
            }

            if (!options.alter) return;

            const transaction = options.transaction!;
            for (const [route, attributes] of Object.entries(this.attributesHandlers)) {
                for (const attributeName of Object.keys(attributes)) {
                    const response = await this.model.create({
                        attribute_name: attributeName,
                        route: route
                    }, { transaction });

                    if (!response) return;
                }

            }

            if (!options.transaction!) transaction.commit();
        }
        public check() {
            return Route.asyncHandler(async (req, res, next) => {
                const route = `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}`;
                const response = await this.model.find({ where: { route } });
                if (!response || !response.length) {
                    res.status(403);
                    throw new Error('Forbidden Access. Failed to find abac record');
                }

                const method = req.method.toUpperCase();
                for (const abac of response) {
                    const hasMethod =
                        (method === 'POST' && abac.check_post!) ||
                        (method === 'GET' && abac.check_get!) ||
                        (method === 'PATCH' && abac.check_patch!) ||
                        (method === 'PUT' && abac.check_put!) ||
                        (method === 'DELETE' && !abac.check_delete!);
                    const checkHandler = await this.attributesHandlers[route][abac.attribute_name!](req);
                    if (hasMethod && !checkHandler) {
                        res.status(403);
                        throw new Error(`Forbidden Access. Resource attribute does not meet the policy '${abac.attribute_name}'`);
                    }
                }

                next();
            });
        }
    }
}

export default AccessControl;
