import { EventEmitter } from "../eventLib/EventEmitter"
import { Type } from "../struct/Type"

export interface EventType<R extends Type<any>> {
    name: string
    result: R
}

export namespace EventType {
    export function define<R extends Type<any>>(name: string, result: R): EventType<R> {
        return { name, result }
    }

    export type ResultType<T extends EventType<any>> = T extends EventType<Type<infer U>> ? U : never

    export type Emitters<T extends Record<string, EventType<any>>> = {
        [P in keyof T]: EventEmitter<ResultType<T[P]>>
    }
}