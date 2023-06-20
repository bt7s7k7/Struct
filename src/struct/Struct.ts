import { Constructor } from "../comTypes/types"
import { SerializationError, Type } from "./Type"

type NullableKeys<T> = { [K in keyof T]: null extends T[K] ? K : never }[keyof T]
type AllowVoidIfAllNullable<T> = Exclude<keyof T, NullableKeys<T>> extends never ? T | void : T

export namespace Struct {
    export function getBaseType(struct: StructBase): Type.ObjectType {
        return (struct.constructor as StructStatics).baseType
    }

    export function getType(struct: StructBase) {
        return struct.constructor as StructStatics
    }

    export class StructBase {
        serialize<T extends { constructor: any }>(this: T): any {
            return this.constructor.serialize(this)
        }
    }

    type FilterProps<T> = Pick<T, keyof T>
    export type StructConcept<T extends Record<string, Type<any>> = Record<string, Type<any>>> = FilterProps<Struct.TypedStruct<Type.ObjectType<T>>> & { new(source: any): Type.ResolveObjectType<T> & StructBase }

    export interface StructStatics<T extends Type.ObjectType = Type.ObjectType> {
        new(source: AllowVoidIfAllNullable<Type.ResolveObjectType<T["props"]>>): StructBase & Type.ResolveObjectType<T["props"]>
        default<T extends { new(...args: any): any }>(this: T): InstanceType<T>
        deserialize<T extends { new(...args: any): any }>(this: T, source: any): InstanceType<T>
        ref<T extends { new(...args: any): any }>(this: T): Type<InstanceType<T>>
        readonly baseType: T
    }

    export type TypedStruct<T extends Type.ObjectType<any>> = Omit<T, "default" | "serialize" | "deserialize"> & StructStatics<T>
    export type ExtendableTypedStruct<T extends Type.ObjectType<any>> = Omit<TypedStruct<T>, "ffff">

    export function define<T extends Record<string, Type<any>>>(name: string, props: T): TypedStruct<Type.ObjectType<T>> {
        const objectType = Type.namedType(name, props)

        class StructInstance extends StructBase {
            constructor(source: Type.ResolveObjectType<T>) {
                super()
                Object.assign(this, source ?? {})
            }

            public static readonly baseType = objectType
        }

        for (const key of [...Object.getOwnPropertyNames(objectType), ...Object.getOwnPropertySymbols(objectType)]) {
            if (key == "default") {
                Object.defineProperty(StructInstance, key, {
                    get() {
                        return () => new this(objectType.default())
                    }
                })

                continue
            }

            if (key == "deserialize") {
                Object.defineProperty(StructInstance, key, {
                    get() {
                        return function (this: any, source: any) {
                            return new this(objectType.deserialize(source))
                        }
                    }
                })

                continue
            }

            Object.defineProperty(StructInstance, key, {
                get() {
                    return (objectType as any)[key]
                }
            })
        }

        const ret = StructInstance as TypedStruct<Type.ObjectType<T>>

        ret.ref = function () {
            return this as any
        }

        return ret
    }

    export type BaseType<T extends Omit<StructStatics<any>, "">> = T extends { baseType: infer U } ? U : never

    const _PolymorphicBase_t = Type.object({ __type: Type.string, id: Type.string })
    export class PolymorphicGraphSerializer<T extends StructBase & { id: string }> {
        protected _types = new Map<string, Constructor<T> & StructStatics>()
        protected _cache: Map<string, { instance: T, type: Constructor<T> & StructStatics, data: any }> | null = null
        protected _ref = Type.createType({
            name: this.name,
            default: () => null,
            serialize: v => v.id,
            deserialize: (id) => {
                if (this._cache == null) throw new SerializationError("Cannot deserialize polymorphic graph reference outside of context")
                const target = this._cache.get(id)
                if (target == null) throw new SerializationError(`Cannot resolve reference to "${id}"`)
                return target
            }
        })

        public register(type: Constructor<T> & Pick<StructStatics, keyof StructStatics>) {
            this._types.set(type.baseType.name, type)
        }

        public deserialize(objectsData: Iterable<any>) {
            if (this._cache != null) throw new Error("Cannot create context, context already exists")
            try {
                this._cache = new Map()
                for (let data of objectsData) {
                    const { __type: typeID, id } = _PolymorphicBase_t.deserialize(data)
                    const type = this._types.get(typeID)
                    const error = new SerializationError(`Cannot find type "${typeID}"`)
                    error.appendPath(id)
                    if (type == null) throw error
                    const instance = type.default()
                    this._cache.set(id, { instance, data, type })
                }

                for (const { instance, data, type } of this._cache.values()) {
                    Object.assign(instance, type.deserialize(data))
                }

                return [...this._cache.values()].map(v => v.instance)
            } finally {
                this._cache = null
            }
        }

        public serialize(objects: Iterable<T>) {
            if (this._cache != null) throw new Error("Cannot create context, context already exists")
            const result: any[] = []
            for (const object of objects) {
                result.push(object.serialize())
            }
            return result
        }

        public ref<U extends T>() {
            return this._ref as Type<U>
        }

        constructor(
            public readonly name: string
        ) { }
    }
}
