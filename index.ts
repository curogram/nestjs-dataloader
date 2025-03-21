import {
  CallHandler,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
  Type,
} from '@nestjs/common';
import { APP_INTERCEPTOR, ModuleRef, ContextIdFactory } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import DataLoader from 'dataloader';
import { ObjectId } from 'mongodb';
import { Types } from 'mongoose';

export class ObjectIdMap<K extends Id, V> implements Omit<Map<K, V>, 'get'> {
  private map: Map<string, [K, V]>;

  constructor(entries: Array<[K, V]> = []) {
    this.map = new Map(entries.map(([k, v]) => [k.toString(), [k, v]]));
  }

  public get(key?: K) {
    return key ? (this.map.get(key.toString()) ?? [])[1] : undefined;
  }

  public set(key: K, value: V) {
    this.map.set(key.toString(), [key, value]);

    return this;
  }

  public clear() {
    this.map.clear();
  }

  public delete(key: K) {
    return this.map.delete(key.toString());
  }

  public has(key: K) {
    return this.map.has(key.toString());
  }

  public get size() {
    return this.map.size;
  }

  public keys() {
    return Array.from(this.map.values()).map(([key]) => key).values();
  }

  public values() {
    return Array.from(this.map.values()).map(([, value]) => value).values();
  }

  public entries() {
    return this.map.values();
  }

  public forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any) {
    new Map(this.map.values()).forEach(callbackfn.bind(thisArg ?? this));
  }

  public [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  public get [Symbol.toStringTag]() {
    return this.constructor.name;
  }

  public [Symbol.for('nodejs.util.inspect.custom')]() {
    return new Map(this.map.values());
  }

  public toJSON() {
    return Array
      .from(this.entries())
      .reduce((res, [key, val]) => ({ ...res, [key.toString()]: val }), {});
  }
}

/**
 * This interface will be used to generate the initial data loader.                
 * The concrete implementation should be added as a provider to your module.
 */
export interface NestDataLoader<ID, Type> {
  /**
   * Should return a new instance of dataloader each time
   */
  generateDataLoader(): DataLoader<ID, Type>;
}

/**
 * Context key where get loader function will be stored.
 * This class should be added to your module providers like so:
 * {
 *     provide: APP_INTERCEPTOR,
 *     useClass: DataLoaderInterceptor,
 * },
 */
const NEST_LOADER_CONTEXT_KEY: string = "NEST_LOADER_CONTEXT_KEY";

@Injectable()
export class DataLoaderInterceptor implements NestInterceptor {
  constructor(private readonly moduleRef: ModuleRef) { }
  /**
   * @inheritdoc
   */
  intercept(context: ExecutionContext, next: CallHandler) {
    const graphqlExecutionContext = GqlExecutionContext.create(context);
    const ctx = graphqlExecutionContext.getContext();

    if (ctx[NEST_LOADER_CONTEXT_KEY] === undefined) {
      ctx[NEST_LOADER_CONTEXT_KEY] = {
        contextId: ContextIdFactory.create(),
        getLoader: (type: string) : Promise<NestDataLoader<any, any>> => {
          if (ctx[type] === undefined) {
            try {
              ctx[type] = (async () => {
                return (await this.moduleRef.resolve<NestDataLoader<any, any>>(type, ctx[NEST_LOADER_CONTEXT_KEY].contextId, { strict: false }))
                  .generateDataLoader();
              })();
            } catch (e) {
              throw new InternalServerErrorException(`The loader ${type} is not provided` + e);
            }
          }
          return ctx[type];
        }
      };
    }
    return next.handle();
  }
}

@Injectable()
export abstract class OrderedDataLoader<ID, Type> implements NestDataLoader<ID, Type> {
  public abstract query(keys: Array<ID>): Promise<Array<Type>>;

  public generateDataLoader() {
    return new DataLoader<ID, Type>(async (keys) => {
      return this.query(keys as Array<ID>);
    });
  }
}

type Id = ObjectId | Types.ObjectId;

export abstract class MongodbDataLoader<ID extends Id, Type extends { _id: Id }, ReturnType>
  extends OrderedDataLoader<ID, ReturnType>
  implements NestDataLoader<ID, ReturnType> {
  protected checkAndOrder(keys: Array<ID>, items: Array<Type> | ObjectIdMap<ID, Type>): Array<Type> {
    const itemsMap = items instanceof ObjectIdMap
      ? items
      : new ObjectIdMap<ID, Type>(items.map(item => [item._id as ID, item]));

    const result = keys.map(id => itemsMap.get(id));

    if (result.some(item => !item)) {
      const missed = keys.filter(id => !itemsMap.get(id));

      throw new Error(`Could not find ${ missed.join(', ') } for ${ this.constructor.name }`);
    }

    return result as Array<Type>;
  }
}

/**
 * The decorator to be used within your graphql method.
 */
export const Loader = createParamDecorator(async (data: Type<NestDataLoader<any, any>>, context: ExecutionContext & { [key: string]: any }) => {
  const ctx: any = GqlExecutionContext.create(context).getContext();
  if (ctx[NEST_LOADER_CONTEXT_KEY] === undefined) {
    throw new InternalServerErrorException(`
            You should provide interceptor ${DataLoaderInterceptor.name} globally with ${APP_INTERCEPTOR}
          `);
  }
  return await ctx[NEST_LOADER_CONTEXT_KEY].getLoader(data);
});
