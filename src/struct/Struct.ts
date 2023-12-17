import { SerializationError, Type } from "./Type"

type NullableKeys<T> = { [K in keyof T]: null extends T[K] ? K : never }[keyof T]
type AllowVoidIfAllNullable<T> = Exclude<keyof T, NullableKeys<T>> extends never ? T | void : T

type ClassCtor = abstract new () => any
type DecoratorType = Type<any> | ClassCtor

const TYPE_HANDLE = Symbol.for("struct.typeHandle")
class TypeHandle {
    protected readonly _props: Record<string, DecoratorType> = {}
    protected _name: string | null = null
    protected _type: Type<any> | null = null
    protected _ctor: ClassCtor | null = null

    public addProperty(key: string, type: DecoratorType) {
        this._props[key] = type
    }

    public setClass(name: string, ctor: ClassCtor) {
        if (this._name != null) throw new Error("Duplicate setting of class for TypeHandle")
        this._name = name
        this._ctor = ctor
    }

    public getType() {
        if (this._type == null) {
            if (this._name == null) throw new Error("Cannot create a type for a decorated class, missing type decorator")
            const ctor = this._ctor as new () => any

            const props: Record<string, Type<any>> = {}
            for (const [key, value] of Object.entries(this._props)) {
                if (typeof value == "function") {
                    const handle = getClassTypeHandle(value)
                    if (handle == null) throw new Error(`Cannot get type from class for property "${key}" in class "${this._name}"`)
                    props[key] = handle.value.getType()
                } else {
                    props[key] = value
                }
            }

            this._type = Type.objectWithClass(ctor, this._name, props, {
                default: () => new ctor()
            })
        }

        return this._type
    }

    constructor(
    ) { }

}

function getClassTypeHandle(ctor: ClassCtor) {
    const original = ctor

    while (ctor != null) {
        if (TYPE_HANDLE in ctor) {
            return {
                class: ctor as ClassCtor,
                value: (ctor as any)[TYPE_HANDLE] as TypeHandle,
                inherited: ctor != original
            }
        }

        ctor = Object.getPrototypeOf(ctor.prototype)?.constructor
    }

    return null
}

function ensureClassTypeHandle(ctor: ClassCtor) {
    let handle

    const existing = getClassTypeHandle(ctor)
    if (existing == null || existing.inherited) {
        handle = (ctor as typeof ctor & { [TYPE_HANDLE]: TypeHandle })[TYPE_HANDLE] = new TypeHandle()
    } else {
        handle = existing.value
    }

    return handle
}

export namespace Struct {
    export function getBaseType(struct: any): Type<any> {
        const type = getType(struct)
        if (type == null) throw new Error("Cannot get base type, because the value is not a struct instance")
        return "baseType" in type ? (type as unknown as StructStatics).baseType as never : type
    }

    export function getType<T extends ClassCtor>(value: T): Type<InstanceType<T>>
    export function getType<T extends { constructor: any }>(value: T): Type<T>
    export function getType(value: ClassCtor | { constructor: any }) {
        if (typeof value == "function") {
            if ("baseType" in value) return value
            return getClassTypeHandle(value as ClassCtor)?.value.getType() ?? null
        } else {
            return getType(value.constructor)
        }
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
    export class PolymorphicGraphSerializer<T extends { id: string }> {
        protected _types = new Map<string, Type<any>>()
        protected _cache: Map<string, { instance: T, type: Type<any>, data: any }> | null = null
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

        public register(ctor: new (...args: any[]) => T) {
            const type = getBaseType(ctor)
            this._types.set(type.name, type)
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
                const type = getBaseType(object)
                result.push(type.serialize(object))
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

    export function type(name: string) {
        return function (ctor: ClassCtor, _: unknown) {
            ensureClassTypeHandle(ctor).setClass(name, ctor)
        }
    }

    export function prop(type: DecoratorType) {
        return function (prototype: any, ctx: string | { name: string }) {
            const name = typeof ctx == "string" ? ctx : ctx.name
            ensureClassTypeHandle(prototype.constructor).addProperty(name, type)
        }
    }
}
