import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"

type _SafeMap<T extends Record<any, any>> = Omit<Map<keyof T, T[keyof T]>, "set" | "get"> & {
    set<K extends keyof T>(key: K, value: T[K]): void
    get<K extends keyof T>(key: K): T[K]
}

type _TypeConstraint = { new(...args: any) }
type _ActionsConstraint = Record<string, Type.Action<Type<any>, Type<any>>>
type _EventsConstrains = Record<string, Type<any>>

export interface RPCContract<B extends _TypeConstraint = _TypeConstraint, K extends (keyof InstanceType<B>) | null = null, A extends _ActionsConstraint = _ActionsConstraint, E extends _EventsConstrains = _EventsConstrains> {
    ctor: B
    primaryKey: K,
    type: Type<InstanceType<B>>
    actions: _SafeMap<A>
    events: _SafeMap<E>
}

export namespace RPCContract {
    export function define<B extends _TypeConstraint, K extends (keyof InstanceType<B>) | null, A extends _ActionsConstraint, E extends _EventsConstrains>(ctor: B, options: { primaryKey: K, actions: A, events: E }): RPCContract<B, K, A, E>
    export function define<B extends _TypeConstraint, K extends (keyof InstanceType<B>) | null, A extends _ActionsConstraint>(ctor: B, options: { primaryKey: K, actions: A, events?: _EventsConstrains }): RPCContract<B, K, A, {}>
    export function define<B extends _TypeConstraint, K extends (keyof InstanceType<B>) | null, E extends _EventsConstrains>(ctor: B, options: { primaryKey: K, events: E, actions?: _ActionsConstraint }): RPCContract<B, K, {}, E>
    export function define<B extends _TypeConstraint, K extends (keyof InstanceType<B>) | null>(ctor: B, options: { primaryKey: K, actions?: _ActionsConstraint, events?: _EventsConstrains }): RPCContract<B, K, {}, {}>
    export function define(ctor: _TypeConstraint, options: { primaryKey: any, actions?: _ActionsConstraint, events?: _EventsConstrains }) {
        return {
            ctor, primaryKey: options.primaryKey,
            type: Struct.getType(ctor),
            actions: options.actions == null ? new Map() : new Map(Object.entries(options.actions)),
            events: options.events == null ? new Map() : new Map(Object.entries(options.events))
        } as RPCContract
    }

    export type Base<T extends RPCContract<any, any, any, any>> = T extends RPCContract<infer U, any, any, any> ? Type<U> : never
    export type Class<T extends RPCContract<any, any, any, any>> = T extends RPCContract<infer U, any, any, any> ? U : never
    export type Actions<T extends RPCContract<any, any, any, any>> = T extends RPCContract<any, any, infer U, any> ? U : never
    export type Events<T extends RPCContract<any, any, any, any>> = T extends RPCContract<any, any, any, infer U> ? U : never
    export type Key<T extends RPCContract<any, any, any, any>> = T["primaryKey"] extends null ? void : InstanceType<RPCContract.Class<T>>[Extract<keyof InstanceType<RPCContract.Class<T>>, T["primaryKey"]>]
}
