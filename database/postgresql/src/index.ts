// MODULES
import pg, { PoolConfig } from 'pg';

// HELPERS
import ch from '@harrypoggers/color';

namespace Pool {
    type DbErrorResult = {
        code: string;
        message: string;
        query: string;
        values: Array<number | string | Date>;
    };
    type DbSuccess = pg.QueryResult;
    type DbFailed = DbErrorResult;
    type DbResult = DbSuccess | DbFailed;

    type DbQueryOptions = {
        values?: Array<any>,
        showError?: boolean,
        showQuery?: boolean,
        transaction?: Transaction | null,
    };

    async function queryHandler(
        query: string,
        values: Array<number | string | Date>,
        showError: boolean,
        tryHandler: () => Promise<pg.QueryResult<any>>,
        errorHandler?: (error: any) => Promise<void>
    ) {
        errorHandler = errorHandler ?? (async () => { });

        try {
            return await tryHandler();
        } catch (error: any) {
            await errorHandler?.(error)!;

            const result: DbErrorResult = {
                code: error.code ?? 'ER_INTERNAL_ERROR',
                message: error.sqlMessage ?? error,
                query,
                values
            };

            if (showError) console.log(ch.red('DB QUERY ERROR:'), result);
            return result;
        }
    }

    export class Pool {
        private pool: pg.Pool;

        constructor(config: PoolConfig) {
            this.pool = new pg.Pool(config);
        }
        async query(query: string, options?: DbQueryOptions): Promise<DbResult> {
            options = {
                values: options?.values ?? [],
                showError: options?.showError ?? true,
                showQuery: options?.showQuery ?? false,
                transaction: options?.transaction ?? null,
            }

            return queryHandler(
                query,
                options.values!,
                options.showError!,
                async () => {
                    const transaction = options.transaction;
                    if (!transaction?.conn) await transaction?.begin(await this.pool.connect());
                    const conn = transaction ? transaction.conn! : this.pool;

                    if (options.showQuery) console.log({ query: query, values: options.values });
                    return await conn.query(query, options.values);
                },
                async (error) => {
                    if (options.transaction && options.transaction.rollbackOnError) await options.transaction.rollback();
                }
            );
        }
        async transaction(options?: TransactionOptions): Promise<Transaction> {
            const transaction = new Transaction(options);
            await transaction.begin(await this.pool.connect());
            return transaction;
        }
    }

    export function isSuccess(response: DbResult): response is DbSuccess {
        const failed = response as any;
        let count = 0;
        const keys = ['code', 'query', 'values', 'message'];
        for (const key of keys) if (failed[key] !== undefined) count++;

        return count < 2;
    }

    export interface TransactionOptions {
        rollbackOnError?: boolean
    }
    export class Transaction {
        public conn: pg.PoolClient | null;
        public rollbackOnError: boolean;

        constructor(options?: TransactionOptions) {
            options = {
                rollbackOnError: options?.rollbackOnError ?? false
            };

            this.conn = null;
            this.rollbackOnError = options.rollbackOnError!;
        }
        public async begin(conn: pg.PoolClient, showError?: boolean) {
            showError = showError ?? true;
            if (this.conn) {
                console.log(ch.red('DB TRANSACTION ERROR:'), 'Failed to begin transaction. Connection already established');
                return;
            }

            this.conn = conn;
            const query = 'COMMIT;';
            await queryHandler(query, [], showError, async () => {
                return this.conn!.query(query);
            });
        }
        public async commit(showError?: boolean) {
            showError = showError ?? true;

            if (!this.conn) {
                console.log(ch.red('DB TRANSACTION ERROR:'), 'Failed to commit transaction. Connection is not established');
                return;
            }

            const query = 'COMMIT;';
            await queryHandler(query, [], showError, async () => {
                return this.conn!.query(query);
            });
            this.end();
        }
        public async rollback(showError?: boolean) {
            showError = showError ?? true;

            if (!this.conn) {
                console.log(ch.red('DB TRANSACTION ERROR:'), 'Failed to commit transaction. Connection is not established');
                return;
            }

            const query = 'ROLLBACK';
            await queryHandler(query, [], showError, async () => {
                return this.conn!.query(query);
            });
            this.end();
        }
        private async end() {
            if (this.conn) {
                this.conn.release();
                this.conn = null;
            }
        }
    }
}

class Placeholder {
    private counter: number;
    constructor() {
        this.counter = 0;
    }
    generate(obj: Record<string, any>, delim?: string): string;
    generate(count: number, delim?: string): string;
    generate(param: number | Record<string, any>, delim: string = ', '): string {
        const result: Array<string> = [];
        if (typeof param === 'number') {
            const count = param;
            for (let i = this.counter; i < this.counter + count; i++) result.push(`$${i + 1}`);
            return result.join(delim);
        }

        const keys = Object.keys(param);
        for (const key of keys) {
            result.push(`${key}=$${this.counter + 1}`);
            this.counter++;
        }
        return result.join(delim);
    }
    values(objs: Array<any>): Array<any> {
        const result: Array<any> = [];
        for (const obj of objs) {
            if (obj === undefined) continue;
            Object.values(obj).forEach(val => result.push(val));
        }
        return result;
    }
}

namespace Db {
    export const DataTypes = {
        SMALLINT: 'SMALLINT',
        INTEGER: 'INTEGER',
        BIGINT: 'BIGINT',
        SERIAL: 'SERIAL',
        NUMERIC: ((precision?: number, scale?: number) => {
            if (precision !== undefined && scale !== undefined) return `NUMERIC(${precision},${scale})` as const;
            else if (precision !== undefined) return `NUMERIC(${precision})` as const;
            return 'NUMERIC' as const;
        }) as {
            (): 'NUMERIC';
            (precision: number): `NUMERIC(${number})`;
            (precision: number, scale: number): `NUMERIC(${number},${number})`;
        },
        REAL: 'REAL',
        DOUBLE_PRECISION: 'DOUBLE PRECISION',
        CHAR: (digits: number) => `CHAR(${digits})` as const,
        VARCHAR: (digits: number) => `VARCHAR(${digits})` as const,
        TEXT: 'TEXT',
        DATE: 'DATE',
        TIME: 'TIME',
        TIMESTAMP: 'TIMESTAMP',
        BOOLEAN: 'BOOLEAN'
    } as const;

    type DataType =
        | typeof DataTypes[keyof typeof DataTypes]
        | ReturnType<typeof DataTypes.CHAR>
        | ReturnType<typeof DataTypes.VARCHAR>;


    type MappedDataType<T extends DataType> =
        T extends "SMALLINT" | "INTEGER" | "BIGINT" | "SERIAL" | "NUMERIC" | `NUMERIC(${number})` | `NUMERIC(${number},${number})` | "REAL" | "DOUBLE PRECISION"
        ? number
        : T extends "TEXT" | `CHAR(${number})` | `VARCHAR(${number})`
        ? string
        : T extends "DATE" | "TIME" | "TIMESTAMP"
        ? Date
        : T extends "BOOLEAN"
        ? boolean
        : never;

    interface ColumnOptions<T extends DataType> {
        type: T;
        allowNull?: boolean;
        defaultValue?: MappedDataType<T>;
        primaryKey?: boolean;
        unique?: boolean;
    }

    type DataValues<T extends Record<string, ColumnOptions<any>>> = {
        [K in keyof T]: MappedDataType<T[K]["type"]> | null;
    };

    type DataKeys<T extends Record<string, ColumnOptions<any>>> = keyof DataValues<T> & string;

    type ModelBody<T extends Record<string, ColumnOptions<any>>> = Partial<DataValues<T>>;

    interface Model<T extends Record<string, ColumnOptions<any>>> {
        tableName: string;
        schema: string;
        pkColumn: string | null;
        create: (body: ModelBody<T>, options?: ModelOptions<T>) => Promise<DataValues<T> | null>;
        find: (options?: ModelOptions<T>) => Promise<Array<DataValues<T>> | null>;
        update: (body: ModelBody<T>, options?: ModelOptions<T>) => Promise<Array<DataValues<T>> | null>;
        delete: (options?: ModelOptions<T>) => Promise<Array<DataValues<T>> | null>;
        findByPk: (pk: number | string, options?: ModelOptions<T>) => Promise<DataValues<T> | null>;
        updateByPk: (pk: number | string, bodyToUpdate: ModelBody<T>, options?: ModelOptions<T>) => Promise<DataValues<T> | null>;
        deleteByPk: (pk: number | string, options?: ModelOptions<T>) => Promise<DataValues<T> | null>;
        setForeignKey: <N extends Record<string, ColumnOptions<any>>>(model: Model<N>, foreignkey: DataKeys<T>, options?: SetForeignKeyOptions<N>) => void;
    }

    interface DefinitionOptions { schema?: string, showQuery?: boolean }
    interface ModelOptions<T extends Record<string, ColumnOptions<any>>> {
        where?: ModelBody<T>;
        transaction?: Pool.Transaction | null;
    }
    interface SetForeignKeyOptions<T extends Record<string, ColumnOptions<any>>> {
        constraintName?: string;
        referenceKey?: DataKeys<T>;
    }

    type QueryType = 'create' | 'drop' | 'drop_constraint' | 'schema' | 'alter';
    class Script {
        private folder: Record<QueryType, Record<string, Array<string>>>;
        private schema: string;
        constructor() {
            this.folder = { create: {}, drop: {}, drop_constraint: {}, schema: {}, alter: {} };
            this.schema = '';
        }
        private addSchema(schemaName: string): void {
            for (const type of Object.keys(this.folder)) {
                this.folder[type as QueryType][schemaName] = [];
            }
            this.folder.schema[schemaName].push(`DROP SCHEMA IF EXISTS ${schemaName};`);
            this.folder.schema[schemaName].push(`CREATE SCHEMA IF NOT EXISTS ${schemaName};`);
        }
        private hasSchema(schemaName: string): boolean {
            for (const type of Object.values(this.folder)) {
                if (type[schemaName] === undefined) return false;
            }

            return true;
        }
        public setSchema(schemaName: string): void {
            if (!this.hasSchema(schemaName)) this.addSchema(schemaName);
            this.schema = schemaName;
        }
        public push(type: QueryType, query: string) {
            this.folder[type][this.schema].push(query);
        }
        public getFolder(): Record<QueryType, Record<string, Array<string>>> {
            return this.folder;
        }
    }
    const script = new Script();
    const syncScripts: Array<string> = [];

    async function modelHandler<T>(callback: () => Promise<T>): Promise<T | null> {
        try {
            return await callback();
        } catch (error: any) {
            console.log(`${ch.red('DB ERROR:')}`, error.message);
            return null;
        }
    }

    interface SyncOptions {
        alter?: boolean;
        onSuccessAlter?: (transaction: Pool.Transaction) => Promise<void>
    }

    export class Db {
        public pool: Pool.Pool;

        constructor(config: PoolConfig) {
            this.pool = new Pool.Pool(config);
        }
        define<T extends Record<string, ColumnOptions<any>>>(
            tableName: string,
            definitionBody: T,
            options?: DefinitionOptions
        ): Model<T> {
            const schema = options?.schema ?? 'public';
            const showQuery = options?.showQuery ?? false;
            script.setSchema(schema);

            let pkColumn: string | null = null;

            // Create table query
            const subquery: Array<string> = [];
            const columns: Array<string> = [];

            for (const [key, val] of Object.entries(definitionBody)) {
                val.allowNull = val.allowNull ?? false;
                val.primaryKey = val.primaryKey ?? false;
                val.unique = val.unique ?? false;

                if (val.primaryKey) pkColumn = key;
                let query = `${key} ${val.type}`;
                if (!val.primaryKey) query += val.allowNull ? '' : ' NOT NULL';
                query += val.primaryKey ? ' PRIMARY KEY' : '';
                if (!val.primaryKey) query += val.unique ? ' UNIQUE' : '';

                if (val.defaultValue !== undefined && val.defaultValue !== '') {
                    query += ' DEFAULT';
                    if (typeof val.defaultValue === 'boolean') query += val.defaultValue ? ' TRUE' : ' FALSE';
                    else if (typeof val.defaultValue === 'string') query += ` '${val.defaultValue}'`;
                    else query += ` ${val.defaultValue}`;
                }
                columns.push(key);
                subquery.push(query);
            }

            script.push('drop', `DROP TABLE IF EXISTS ${schema}.${tableName};`);
            script.push('create', `CREATE TABLE IF NOT EXISTS ${schema}.${tableName} (${subquery.join(', ')});`);
            syncScripts.push(`SELECT ${columns.join(', ')} FROM ${schema}.${tableName};`);

            const pool = this.pool;
            return {
                tableName,
                schema,
                pkColumn,
                async create(body: ModelBody<T>, options?: ModelOptions<T>): Promise<DataValues<T> | null> {
                    return await modelHandler(async () => {
                        const keys = Object.keys(body);
                        const values = Object.values(body);
                        const placeholder = new Placeholder();
                        const transaction = options?.transaction;
                        const query =
                            `INSERT INTO ${schema}.${tableName} (${keys.join(', ')}) ` +
                            `VALUES (${placeholder.generate(values.length)}) RETURNING *;`;

                        const response = await pool.query(query, { values, showQuery, transaction });
                        if (!Pool.isSuccess(response)) throw new Error(`Failed to create data. ${response.message}`);

                        return response.rows[0] as DataValues<T>;
                    });
                },
                async find(options?: ModelOptions<T>): Promise<Array<DataValues<T>> | null> {
                    return await modelHandler(async () => {
                        const placeholder = new Placeholder();
                        const where = options?.where ? ` WHERE ${placeholder.generate(options.where, ' AND ')}` : '';
                        const query = `SELECT * FROM ${schema}.${tableName}${where};`;
                        const transaction = options?.transaction;
                        const values = placeholder.values([options?.where]);

                        const response = await pool.query(query, { values, showQuery, transaction });
                        if (!Pool.isSuccess(response)) throw new Error(`Failed to find data. ${response.message}`);

                        return response.rows as Array<DataValues<T>>;
                    });
                },
                async update(bodyToUpdate: ModelBody<T>, options?: ModelOptions<T>): Promise<Array<DataValues<T>> | null> {
                    return await modelHandler(async () => {
                        const placeholder = new Placeholder();
                        const set = `SET ${placeholder.generate(bodyToUpdate)}`;
                        const where = options?.where ? ` WHERE ${placeholder.generate(options.where, ' AND ')}` : '';
                        const query = `UPDATE ${schema}.${tableName} ${set}${where} RETURNING *;`;
                        const transaction = options?.transaction;
                        const values = placeholder.values([bodyToUpdate, options?.where]);

                        const response = await pool.query(query, { values, showQuery, transaction });
                        if (!Pool.isSuccess(response)) throw new Error(`Failed to update data. ${response.message}`);

                        return response.rows as Array<DataValues<T>>;
                    })
                },
                async delete(options?: ModelOptions<T>): Promise<Array<DataValues<T>> | null> {
                    return modelHandler(async () => {
                        const placeholder = new Placeholder();
                        const where = options?.where ? ` WHERE ${placeholder.generate(options.where, ' AND ')}` : '';
                        const query = `DELETE FROM ${schema}.${tableName}${where} RETURNING *;`;
                        const transaction = options?.transaction;
                        const values = placeholder.values([options?.where]);

                        const response = await pool.query(query, { values, showQuery, transaction });
                        if (!Pool.isSuccess(response)) throw new Error(`Failed to delete data. ${response.message}`);

                        return response.rows as Array<DataValues<T>>;
                    });
                },
                async findByPk(pk: number | string, options?: ModelOptions<T>): Promise<DataValues<T> | null> {
                    return modelHandler(async () => {
                        if (pkColumn === null) throw new Error(`Failed to find data by pk. Table ${tableName} does not have a primary key`);

                        options = {
                            where: options?.where ?? {},
                            transaction: options?.transaction ?? null
                        };
                        (options.where as any)[pkColumn] = pk;

                        const placeholder = new Placeholder();
                        const where = ` WHERE ${placeholder.generate(options.where!, ' AND ')}`
                        const query = `SELECT * FROM ${schema}.${tableName}${where};`;
                        const transaction = options?.transaction;
                        const values = placeholder.values([options.where]);

                        const response = await pool.query(query, { values, showQuery, transaction });
                        if (!Pool.isSuccess(response)) throw new Error(`Failed to find data by pk (${pkColumn}=${typeof pk === 'string' ? `'${pk}'` : pk}). ${response.message}`);
                        if (!response.rows.length) throw new Error(`Failed to find data by pk (${pkColumn}=${pk}). No data found`);

                        return response.rows[0] as DataValues<T>;
                    });
                },
                async updateByPk(pk: number | string, bodyToUpdate: ModelBody<T>, options?: ModelOptions<T>): Promise<DataValues<T> | null> {
                    return modelHandler(async () => {
                        if (pkColumn === null) throw new Error(`Failed to update data by pk. Table ${tableName} does not have a primary key`);

                        options = {
                            where: options?.where ?? {},
                            transaction: options?.transaction ?? null
                        };
                        (options.where as any)[pkColumn] = pk;

                        const placeholder = new Placeholder();
                        const set = ` SET ${placeholder.generate(bodyToUpdate)}`;
                        const where = ` WHERE ${placeholder.generate(options.where!, ' AND ')}`;
                        const query = `UPDATE ${schema}.${tableName}${set}${where} RETURNING *;`;
                        const transaction = options?.transaction;
                        const values = placeholder.values([bodyToUpdate, options.where]);

                        const response = await pool.query(query, { values, showQuery, transaction });
                        if (!Pool.isSuccess(response)) throw new Error(`Failed to update data by pk (${pkColumn}=${typeof pk === 'string' ? `'${pk}'` : pk}). ${response.message}`);
                        if (!response.rows.length) throw new Error(`Failed to update data by pk (${pkColumn}=${pk}). No data found`);

                        return response.rows[0] as DataValues<T>;
                    });
                },
                async deleteByPk(pk: number | string, options?: ModelOptions<T>): Promise<DataValues<T> | null> {
                    return modelHandler(async () => {
                        if (pkColumn === null) throw new Error(`Failed to delete data by pk. Table ${tableName} does not have a primary key`);

                        options = {
                            where: options?.where ?? {},
                            transaction: options?.transaction ?? null
                        };
                        (options.where as any)[pkColumn] = pk;

                        const placeholder = new Placeholder();
                        const where = ` WHERE ${placeholder.generate(options.where!, ' AND ')}`;
                        const query = `DELETE FROM ${schema}.${tableName}${where} RETURNING *;`;
                        const transaction = options?.transaction;
                        const values = placeholder.values([options.where]);

                        const response = await pool.query(query, { values, showQuery, transaction });
                        if (!Pool.isSuccess(response)) throw new Error(`Failed to delete data by pk (${pkColumn}=${typeof pk === 'string' ? `'${pk}'` : pk}). ${response.message}`);
                        if (!response.rows.length) throw new Error(`Failed to delete data by pk (${pkColumn}=${pk}). No data found`);

                        return response.rows[0] as DataValues<T>;
                    });
                },
                setForeignKey(model, foreignKey, options): void {
                    options = {
                        constraintName: options?.constraintName ?? `${tableName}_${model.tableName}`,
                        referenceKey: options?.referenceKey ?? foreignKey
                    }

                    script.push('drop_constraint',
                        `ALTER TABLE IF EXISTS ${schema}.${tableName} ` +
                        `DROP CONSTRAINT IF EXISTS fk_${options.constraintName};`
                    );

                    script.push('alter',
                        `ALTER TABLE IF EXISTS ${schema}.${tableName} ` +
                        `ADD CONSTRAINT fk_${options.constraintName} ` +
                        `FOREIGN KEY (${foreignKey}) ` +
                        `REFERENCES ${model.schema}.${model.tableName} (${options.referenceKey}) ` +
                        'ON DELETE CASCADE ' +
                        'ON UPDATE CASCADE;'
                    );
                },
            }
        }
        async transaction(options?: Pool.TransactionOptions): Promise<Pool.Transaction> {
            return await this.pool.transaction(options);
        }
        async sync(options?: SyncOptions): Promise<void> {
            options = {
                alter: options?.alter ?? false,
                onSuccessAlter: options?.onSuccessAlter ?? (async () => { })
            }

            if (!options?.alter!) {
                for (const query of syncScripts) {
                    await this.pool.query(query)
                }

                return;
            }

            const transaction = await this.transaction({ rollbackOnError: true });
            const folder = script.getFolder();
            const sequence: Array<QueryType> = ['drop_constraint', 'drop', 'schema', 'create', 'alter'];
            for (const key of sequence) {
                for (const type of Object.values(folder[key as QueryType])) {
                    for (const query of type) {
                        const response = await this.pool.query(query, { transaction });
                        if (!Pool.isSuccess(response)) return;
                    }
                }
            }
            await options.onSuccessAlter?.(transaction);
            await transaction.commit();
        }
    }
}

export const DataTypes = Db.DataTypes;
export default Db;
export { Pool };

