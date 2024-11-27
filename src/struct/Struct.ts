import { DeserializationError, Deserializer, DeserializerFactory, PlainObjectDeserializer, PlainObjectSerializer, Serializer, SerializerFactory, Type } from "./Type"

type NullableKeys<T> = { [K in keyof T]: null extends T[K] ? K : never }[keyof T]
type AllowVoidIfAllNullable<T> = Exclude<keyof T, NullableKeys<T>> extends never ? T | void : T

type ClassCtor = abstract new () => any

export namespace Struct {
    export function getBaseType(struct: any): Type<any> {
        if (Type.isType(struct)) return struct

        const type = getType(struct)
        if (type == null) throw new Error("Cannot get base type, because the value is not a struct instance")
        return "baseType" in type ? (type as unknown as StructStatics).baseType as never : type
    }

    export function getType<T extends ClassCtor>(value: T): Type<InstanceType<T>>
    export function getType<T extends { constructor: any }>(value: T): Type<T>
    export function getType(value: ClassCtor | { constructor: any }) {
        if (Type.isType(value)) return value

        if (typeof value == "function") {
            if ("baseType" in value && "ref" in value) return (value as Struct.StructStatics).ref() as any
            throw new Error("Value is not a struct")
        } else {
            return getType(value.constructor)
        }
    }

    /** All instance properties on a struct */
    export interface StructBase {
        /** Serializes this instance. Short for `this.constructor.ref().serialize(this)`. */
        serialize(): any
    }

    /** All static properties on a struct */
    export interface StructStatics<T extends Type = Type, B = {}> {
        new(source: AllowVoidIfAllNullable<ReturnType<T["default"]>>): StructBase & ReturnType<T["default"]> & B
        /** Creates a default instance of this struct. Short for `this.ref().default()` */
        default<T extends { new(...args: any): any }>(this: T): InstanceType<T>
        /** Deserializes an instance of this struct. Short for `this.ref().deserialize(source)` */
        deserialize<T extends { new(...args: any): any }>(this: T, source: any): InstanceType<T>
        /** Returns the type definition of this struct. */
        ref<T extends { new(...args: any): any }>(this: T): Type.ObjectType<InstanceType<T>>
        /** Base type that this struct type definition derives from. Use this to define migrations, but make sure to do it before calling {@link ref}. */
        readonly baseType: T
    }

    /** Options for {@link Struct.define} */
    export interface StructDefineOptions {
        /** Allow you to replace the type definition used as a base the struct. The returned value is then derived, using {@link Type.derive}, for every class inheriting the struct. */
        baseTypeDecorator?: (type: Type.ObjectType) => Type.ObjectType
    }

    /**
     * Defines a new struct. Inherit from the returned class.
     * @example
     * class Person extends Struct.define("Person", {
     *     name: Type.string
     * }) {}
     * */
    export function define<T extends Record<string, Type<any>>>(name: string, props: T): StructStatics<Type.TypedObjectType<T>, InstanceType<typeof Object>>
    export function define<T extends Record<string, Type<any>>>(name: string, props: T, base: undefined): StructStatics<Type.TypedObjectType<T>, InstanceType<typeof Object>>
    export function define<T extends Record<string, Type<any>>>(name: string, props: T, base: undefined, options: StructDefineOptions): StructStatics<Type.TypedObjectType<T>, InstanceType<typeof Object>>
    export function define<T extends Record<string, Type<any>>, B extends abstract new () => any = typeof Object>(name: string, props: T, base: B, options?: StructDefineOptions): StructStatics<Type.TypedObjectType<T>, InstanceType<B>>
    export function define<T extends Record<string, Type<any>>, B extends abstract new () => any = typeof Object>(name: string, props: T, base?: B, options?: StructDefineOptions): StructStatics<Type.TypedObjectType<T>, InstanceType<B>> {
        let objectType: Type.ObjectType = Type.namedType(name, props)
        if (options?.baseTypeDecorator) {
            objectType = options.baseTypeDecorator(objectType)
        }

        const inheritorMap = new Map<any, Type>()

        // Because the instance fields are populated from the user supplied source parameter, the order
        // of the specified fields may be different which can result in class instances having different
        // internal types assigned by the JavaScript VM. Therefore, we create all instance properties
        // without a value in a uniform order and then assign their values.

        const defaultProperties = Object.fromEntries(objectType.propList.map(v => [v[0], null]))

        class StructInstance extends (base ?? Object) implements StructBase {
            public serialize<T extends { constructor: any }>(this: T): any {
                return (this.constructor as typeof StructInstance).ref().serialize(this)
            }

            constructor(source: Type.ResolveObjectType<T>) {
                super()
                Object.assign(this, defaultProperties, source ?? {})
                if ("_postDeserialize" in this) {
                    (this as any)._postDeserialize()
                }
            }

            public static readonly baseType = objectType

            public static ref() {
                const existing = inheritorMap.get(this)
                if (existing) {
                    return existing
                }

                const ctor = this as any
                const type = objectType.derive(class extends (objectType.constructor as any) {
                    public _makeBase() {
                        return new ctor()
                    }
                }.prototype)
                inheritorMap.set(this, type)
                return type
            }

            public static default() {
                return this.ref().default()
            }

            public static deserialize(source: unknown) {
                return this.ref().deserialize(source)
            }
        }

        return StructInstance as any
    }

    const _PolymorphicBase_t = Type.object({ ["!type"]: Type.atom })

    class _PolymorphicSerializerRef extends Type<any> {
        public getDefinition(indent: string): string {
            return indent + this.name
        }

        public default() {
            return null
        }

        public verify(value: unknown) {
            const type = Struct.getBaseType(value)
            return type.verify(value)
        }

        protected _serialize(source: any, serializer: Serializer<unknown, unknown, unknown, unknown>): unknown {
            const type = Struct.getBaseType(source)
            const data = type["_serialize"](source, serializer)
            serializer.addObjectProperty(data, "!type", type.name)
            return data
        }

        protected _deserialize(handle: any, deserializer: Deserializer<unknown, unknown, unknown, unknown>) {
            const typeID = _PolymorphicBase_t["_deserialize"](handle, deserializer)["!type"]
            const type = this.types.get(typeID)
            if (type == null) throw new DeserializationError(`Cannot find type "${typeID}"`)

            try {
                return type["_deserialize"](handle, deserializer)
            } catch (err) {
                if (err instanceof DeserializationError) err.appendPath(`(${typeID})`)
                throw err
            }
        }

        constructor(
            public readonly name: string,
            public readonly types: Map<string, Type<any>>,
        ) { super() }
    }

    /**
     * Allows for the (de)serialization of multiple types. During serialization the name of the serialized type
     * is stored and during deserialization the type is looked up and deserialized. Consider overriding the {@link StructBase#serialize}
     * method on registered types to receive a tagged serialized object directly. The {@link PolymorphicSerializer#base} property is 
     * used for serializing values, but during type definition, you can use {@link PolymorphicSerializer#ref} to specify a type of 
     * a property. This type is only compile-time however and type-erased during runtime.
     * */
    export class PolymorphicSerializer<T> {
        protected _types = new Map<string, Type<any>>()
        protected _ref = new _PolymorphicSerializerRef(this.name, this._types)

        /** The type definition used for (de)serializing.  */
        public get base() { return this._ref as any as Type<T> }

        /** 
         * Returns all registered types. During type definition, you can use {@link PolymorphicSerializer#ref} to specify a type 
         * of a property. This type is only compile-time however and type-erased during runtime.
         **/
        public getTypes() {
            return this._types as ReadonlyMap<string, Type<any>>
        }

        /** Returns the names of all registered types. */
        public getTypeNames() {
            return [...this._types.keys()]
        }

        /** Registers a type for (de)serialization. Only the registered types will be considered during deserialization. */
        public register(ctor: new (...args: any[]) => T) {
            const type = getType(ctor)
            this._types.set(getBaseType(type).name, type)
        }

        /** Use this method to specify a type for a serialized property. This type is only compile-time however and type-erased during runtime. */
        public ref<U extends T = T>() {
            return this.base as Type<U>
        }

        constructor(
            public readonly name: string,
        ) { }
    }

    const _PolymorphicGraphBase_t = Type.object({ ["!type"]: Type.atom, id: Type.string })
    class _PolymorphicGraphSerializerRef extends Type<any> {
        public getDefinition(indent: string): string {
            return indent + this.name
        }

        public default() {
            return null
        }

        public verify(value: unknown) {
            const type = Struct.getBaseType(value)
            return type.verify(value)
        }

        protected _serialize(source: any, serializer: Serializer<unknown, unknown, unknown, unknown>): unknown {
            return serializer.createPrimitive(source.id)
        }

        protected _deserialize(handle: any, deserializer: Deserializer<unknown, unknown, unknown, unknown>) {
            const id = Type.string["_deserialize"](handle, deserializer)
            const target = this.contextGetter(id)
            if (target == null) throw new DeserializationError(`Cannot resolve reference to "${id}"`)
            return target
        }

        constructor(
            public readonly name: string,
            public readonly contextGetter: (id: string) => any,
        ) { super() }
    }

    /**
     * Extension for {@link PolymorphicSerializer} that allows circular references.
     * All registered types must have a string `id` property, and (de)serialization
     * must be started by using the {@link PolymorphicGraphSerializer#serialize} or {@link PolymorphicGraphSerializer#deserialize} methods.
     * */
    export class PolymorphicGraphSerializer<T extends { id: string }> extends PolymorphicSerializer<T> {
        protected _contextGetter: ((id: string) => any | null | undefined) | null = null
        protected _graphRef = new _PolymorphicGraphSerializerRef(this.name, (id) => {
            if (this._contextGetter == null) throw new DeserializationError("Cannot deserialize polymorphic graph reference outside of context")
            return this._contextGetter(id)
        })

        public get base() { return this._graphRef as any as Type<T> }

        public createContext(getter: (id: string) => any | null | undefined, thunk: () => void) {
            if (this._contextGetter != null) throw new Error("Cannot create context, context already exists")
            try {
                this._contextGetter = getter
                thunk()
            } finally {
                this._contextGetter = null
            }
        }

        public deserialize(objectsData: any[]): T[]
        public deserialize<U extends DeserializerFactory>(source: ConstructorParameters<U>[0], deserializer: U): T[]
        public deserialize(source: any, deserializerCtor: DeserializerFactory = PlainObjectDeserializer) {
            if (this._contextGetter != null) throw new Error("Cannot create context, context already exists")
            const deserializer = new deserializerCtor(source)
            const objectsHandle = deserializer.parseArray(deserializer.getRootHandle())
            if (objectsHandle == null) throw new DeserializationError("Expected array of objects")

            try {
                const cache = new Map<string, { instance: T, type: Type<any>, data: any }>()
                this._contextGetter = id => cache.get(id)?.instance
                let index = -1
                for (let handle of deserializer.getArrayElements(objectsHandle)) {
                    index++
                    const data = deserializer.parseObject(handle)
                    if (data == null) throw new DeserializationError("Expected object").appendPath(index.toString())

                    try {
                        const { ["!type"]: typeID, id } = _PolymorphicGraphBase_t["_deserialize"](data, deserializer)

                        const type = this._types.get(typeID)
                        if (type == null) {
                            const error = new DeserializationError(`Cannot find type "${typeID}"`)
                            error.appendPath(id)
                            throw error
                        }

                        const instance = type.default()
                        cache.set(id, { instance, data, type })
                    } catch (err) {
                        if (err instanceof DeserializationError) err.appendPath(index.toString())
                        throw err
                    }
                }

                index = -1
                for (const { instance, data, type } of cache.values()) {
                    index++
                    try {
                        Object.assign(instance, Struct.getBaseType(type)["_deserialize"](data, deserializer))
                        if ("_postDeserialize" in instance) (instance as any)._postDeserialize()
                    } catch (err) {
                        if (err instanceof DeserializationError) err.appendPath(index.toString())
                        throw err
                    }
                }

                return [...cache.values()].map(v => v.instance)
            } finally {
                this._contextGetter = null
            }
        }

        public serialize(objects: Iterable<T>): any[]
        public serialize<U extends SerializerFactory>(objects: Iterable<T>, serializer: U): ReturnType<InstanceType<U>["finish"]>
        public serialize(objects: Iterable<T>, serializer: SerializerFactory = PlainObjectSerializer) {
            const serializerInstance = new serializer()
            const result = serializerInstance.createArray()

            for (const object of objects) {
                const value = this._ref["_serialize"](object, serializerInstance)
                serializerInstance.addArrayElement(result, value)
            }

            return result
        }

        public removeReferences(target: T, objects: Iterable<T>) {
            const visit = (object: any, type: Type<any>, path: string) => {
                if (Type.isNullable(type)) {
                    if (object == null) return
                    type = type.base
                }

                if (Type.isObject(type)) {
                    for (const [key, propType] of type.propList) {
                        const value = object[key]
                        const newPath = path + key
                        if (value == target) {
                            if (Type.isNullable(propType)) {
                                object[key] = null
                            } else if (Type.isOptional(propType)) {
                                object[key] = propType.default()
                            } else throw new Error(`Cannot remove reference, property ${JSON.stringify(newPath)} is not nullable (${propType.name})`)
                        } else {
                            visit(value, propType, newPath)
                        }
                    }
                } else if (Type.isMap(type)) {
                    for (const [key, value] of [...object]) {
                        const value = object[key]
                        if (value == target) {
                            object.delete(key)
                        } else {
                            visit(value, type.valueType, path + "." + key)
                        }
                    }
                } else if (Type.isArray(type)) {
                    for (let i = 0; i < object.length; i++) {
                        const value = object[i]
                        if (value == target) {
                            object.splice(i, 1)
                            i--
                        } else {
                            visit(value, type.elementType, path + "." + i)
                        }
                    }
                }
            }

            for (const object of objects) {
                visit(object, Struct.getType(object), "")
            }
        }

        constructor(
            name: string,
        ) { super(name) }
    }
}
