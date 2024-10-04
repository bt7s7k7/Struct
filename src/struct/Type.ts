
type _Extract<T, U> = Extract<T, U>

export class DeserializationError extends Error {
    public name = "DeserializationError"
    public path = ""

    protected _updateMessage() {
        const newMessage = `Invalid type at .${this.path} : ${this._message}`
        this.message = this._oldMessage.replace(/__MSG/, newMessage)
        this.stack = this._oldStack.replace(/__MSG/, newMessage)
    }

    public appendPath(path: string) {
        this.path = `${path}${this.path ? `.${this.path}` : this.path}`
        this._updateMessage()
    }


    protected readonly _isClientError = true
    protected readonly _oldMessage: string
    protected readonly _oldStack: string

    constructor(
        protected readonly _message: string
    ) {
        super("__MSG")

        this._oldMessage = this.message
        this._oldStack = this.stack ?? ""

        this._updateMessage()
    }
}

/** @deprecated Use {@link DeserializationError} */
export const SerializationError = DeserializationError

export abstract class Serializer<I = unknown, O = unknown, A = unknown, M = unknown> {
    public abstract createPrimitive(value: string | number | boolean): I
    public abstract createAtom(value: string | number | boolean): I
    public abstract createNull(): I
    public abstract createAny(value: any): I

    public abstract createObject(): O
    public abstract addObjectProperty(handle: O, key: string, value: I): I

    public abstract createArray(): A
    public abstract addArrayElement(handle: A, value: I): I

    public abstract createMap(): M
    public abstract addMapProperty(handle: M, key: I, value: I): I

    public abstract finish(root: I): unknown
}

export abstract class Deserializer<I = unknown, O = unknown, A = unknown, M = unknown> {
    public abstract getRootHandle(): I

    public abstract parsePrimitive(source: I): string | number | boolean
    public abstract parseAtom(source: I): string | number | boolean
    public abstract isNull(source: I): boolean
    public abstract parseAny(source: I): any

    public abstract parseObject(source: I): O | null
    public abstract getObjectProperty(handle: O, key: string): I

    public abstract parseArray(source: I): A | null
    public abstract getArrayElements(source: A): Generator<I, void, void>

    public abstract parseMap(source: I): M | null
    public abstract getMapProperties(source: I): Generator<[I, I], void, void>
}

export class PlainObjectSerializer extends Serializer<any> {
    public createPrimitive(value: string | number | boolean) {
        return value
    }

    public createAtom(value: string | number | boolean) {
        return value
    }

    public createNull() {
        return null
    }

    public createAny(value: any) {
        return value
    }

    public createObject() {
        return {}
    }

    public addObjectProperty(handle: any, key: string, value: any) {
        handle[key] = value
    }

    public createArray() {
        return []
    }

    public addArrayElement(handle: any[], value: any) {
        handle.push(value)
    }

    public createMap() {
        return {}
    }

    public addMapProperty(handle: any, key: any, value: any) {
        handle[key] = value
    }

    public finish(root: any): any {
        return root
    }
}

export class PlainObjectDeserializer extends Deserializer<any, Record<string, any>, any[], Record<string, any>> {
    public getRootHandle() {
        return this.root
    }

    public parsePrimitive(source: any): string | number | boolean {
        return source
    }

    public parseAtom(source: any): string | number | boolean {
        return source
    }

    public isNull(source: any): boolean {
        return source == null
    }

    public parseAny(source: any) {
        return source
    }

    public parseObject(source: any): Record<string, any> | null {
        if (typeof source != "object" || source == null || Array.isArray(source)) return null
        return source
    }

    public getObjectProperty(handle: Record<string, any>, key: string) {
        if (!(key in handle)) return null

        return handle[key]
    }

    public parseArray(source: any): any[] | null {
        if (!Array.isArray(source)) return null
        return source
    }

    public *getArrayElements(source: any[]): Generator<any, void, void> {
        for (const value of source) {
            yield value
        }
    }

    public parseMap(source: any): Record<string, any> | null {
        return this.parseObject(source)
    }

    public *getMapProperties(source: Record<string, any>): Generator<[any, any], void, void> {
        for (const keyValue of Object.entries(source)) {
            yield keyValue
        }
    }

    constructor(
        public readonly root: any
    ) { super() }
}

class _CloneDeserializer extends Deserializer<any, Record<string, any>, any[], Map<any, any>> {
    public getRootHandle() {
        return this.root
    }

    public parsePrimitive(source: any): string | number | boolean {
        return source
    }

    public parseAtom(source: any): string | number | boolean {
        return source
    }

    public isNull(source: any): boolean {
        return source == null
    }

    public parseAny(source: any) {
        return source
    }

    public parseObject(source: any): Record<string, any> | null {
        return source
    }

    public getObjectProperty(handle: Record<string, any>, key: string) {
        return handle[key]
    }

    public parseArray(source: any): any[] | null {
        return source
    }

    public *getArrayElements(source: any[]): Generator<any, void, undefined> {
        yield* source
    }

    public parseMap(source: any): Map<any, any> | null {
        return source
    }

    public *getMapProperties(source: Map<any, any>): Generator<[any, any], void, undefined> {
        yield* source
    }

    constructor(
        public readonly root: any
    ) { super() }
}

export type SerializerFactory = { new(): Serializer }
export type DeserializerFactory = { new(value: any): Deserializer }

const _DEFAULT_METADATA = new Map()
export abstract class Type<T = any> {
    public readonly abstract name: string
    public abstract getDefinition(indent: string): string
    public abstract default(): T

    public get definition() { return this.getDefinition("") }

    protected _annotations: Map<any, any> | null = null

    public as<R, A extends any[]>(typeFactory: (type: this, ...args: A) => R, ...args: A): R {
        return typeFactory(this, ...args)
    }

    /** Begins serialization using the source as a root value. If no serializer is specified, uses {@link PlainObjectSerializer}. */
    public serialize(source: T): any
    public serialize<U extends SerializerFactory>(source: T, serializer: U): ReturnType<InstanceType<U>["finish"]>
    public serialize(source: T, serializerCtor: SerializerFactory = PlainObjectSerializer): unknown {
        const serializer = new serializerCtor()
        const rootHandle = this._serialize(source, serializer)
        return serializer.finish(rootHandle)
    }

    /** Begins deserialization using the source as a root value. If no deserializer is specified, uses {@link PlainObjectDeserializer}. */
    public deserialize(source: any): T
    public deserialize<U extends DeserializerFactory>(source: ConstructorParameters<U>[0], deserializer: U): T
    public deserialize(source: any, deserializerCtor: DeserializerFactory = PlainObjectDeserializer): T {
        const deserializer = new deserializerCtor(source)
        return this._deserialize(deserializer.getRootHandle(), deserializer)
    }

    /**
     * Creates a shallow copy of this type definition. Used when you want to modify some properties, but don't want to influence
     * the original object, like for example using {@link Type#annotate}. * If you also want to override some methods,
     * you can provide a custom prototype.
     * */
    public derive(prototype = Object.getPrototypeOf(this)): this {
        return Object.assign(Object.create(prototype), this)
    }

    /** Creates a copy of this type with the specified metadata added. Get all metadata using {@link Type#getMetadata}. */
    public annotate(...metadata: any[]) {
        const newMetadata = metadata.map(v => [v.constructor, v] as const)
        const resultType = this.derive()
        if (this._annotations == null) {
            resultType._annotations = new Map(newMetadata)
            return resultType
        }

        resultType._annotations = new Map([...this._annotations, ...newMetadata])
        return resultType
    }

    /** Returns metadata with which this type has been annotated with using {@link Type#annotate}. */
    public getMetadata() {
        if (this._annotations == null) {
            return _DEFAULT_METADATA as Type.Metadata
        }

        return this._annotations as Type.Metadata
    }

    /** Creates a deep copy of a value using type information. */
    public clone(value: T) {
        return this.deserialize(value, _CloneDeserializer)
    }

    /** Verifies that the value matches the specified type information. If there is a mismatch an error is thrown. */
    public abstract verify(value: unknown): T

    protected abstract _serialize(source: T, serializer: Serializer): unknown
    protected abstract _deserialize(handle: any, deserializer: Deserializer): T
}


export namespace Type {
    /** Gets instance value of a type definition */
    export type Extract<T extends Type> = T extends Type<infer U> ? U : never

    /** Makes nullable properties optional */
    export type NullablePartial<T> =
        & { [P in keyof T as (null extends T[P] ? never : P)]: T[P] }
        & { [P in keyof T as (null extends T[P] ? P : never)]?: T[P] }

    /** Gets type of an object type definition */
    export type ResolveObjectType<T extends Record<string, Type>> = NullablePartial<{
        [P in keyof T]: Extract<T[P]>
    }>

    export interface Metadata {
        get<T extends new (...args: any) => any>(type: T): InstanceType<T> | undefined
        has(type: new (...args: any) => any): boolean
        [Symbol.iterator](): IterableIterator<[new (...args: any) => any, any]>
        readonly size: number
    }

    export function isType(value: unknown): value is Type {
        return value instanceof Type
    }



    /**
     * Creates a type definition representing an atom. During type checking, the type is compared to the default value.
     * Do not use this class directly, instead use the pre-constructed {@link Type.atom}.
     * */
    export class AtomType<T> extends Type<T> {
        protected readonly _typeof = typeof this._default

        public getDefinition(indent: string) {
            return indent + this.name
        }

        public default() {
            return this._default
        }

        protected _serialize(source: T, serializer: Serializer) {
            return serializer.createAtom(source as any)
        }

        protected _deserialize(handle: any, deserializer: Deserializer) {
            const source = deserializer.parseAtom(handle)
            if (typeof source != this._typeof) throw new DeserializationError("Expected " + this.name)
            return source as T
        }

        public verify(value: unknown) {
            if (typeof value != this._typeof) throw new DeserializationError("Expected " + this.name)
            return value as T
        }

        constructor(
            public readonly name: string,
            protected readonly _default: T
        ) { super() }
    }

    /** Type definition for a string atom */
    export const atom = new AtomType("atom", "")



    /**
     * Creates a type definition representing a primitive. During type checking, the type is compared to the default value.
     * Do not use this class directly but use any of the constructed definitions: {@link Type.number}, {@link Type.boolean},
     * {@link Type.string} or {@link Type.empty}.
     * */
    export class PrimitiveType<T> extends Type<T> {
        protected readonly _typeof = typeof this._default

        public getDefinition(indent: string) {
            return indent + this.name
        }

        public default() {
            return this._default
        }

        protected _serialize(source: T, serializer: Serializer) {
            return serializer.createPrimitive(source as any)
        }

        protected _deserialize(handle: any, deserializer: Deserializer) {
            const source = deserializer.parsePrimitive(handle)
            if (typeof source != this._typeof) throw new DeserializationError("Expected " + this.name)
            return source as T
        }

        public verify(value: unknown) {
            if (typeof value != this._typeof) throw new DeserializationError("Expected " + this.name)
            return value as T
        }
        constructor(
            public readonly name: string,
            protected readonly _default: T
        ) { super() }
    }

    /** Type definition for the `number` primitive */
    export const number = new PrimitiveType("number", 0)
    /** Type definition for the `boolean` primitive */
    export const boolean = new PrimitiveType("boolean", false)
    /** Type definition for the `string` primitive */
    export const string = new PrimitiveType("string", "")
    /** Type definition for an empty value, can represent `null`, `undefined` or `void`. */
    export const empty = new class EmptyType extends PrimitiveType<void> {
        public verify(value: unknown): void { }
        protected _deserialize(handle: any, deserializer: Deserializer<unknown, unknown, unknown, unknown>): void { }

        constructor() { super("empty", null as unknown as void) }
    } as PrimitiveType<void>



    const IS_ARRAY = Symbol.for("struct.isArray")

    /** Predicate for testing if a {@link Type} is an {@link ArrayType} */
    export const isArray = (type: Type): type is ArrayType<any> => IS_ARRAY in type

    /** Type definition for arrays, do not use this class directly, instead use {@link Type.array} factory function. */
    export class ArrayType<T> extends Type<T[]> {
        public name = this.elementType.name + "[]"
        public readonly [IS_ARRAY] = true

        public getDefinition(indent: string) {
            return this.elementType.getDefinition(indent) + "[]"
        }

        public default() {
            return [] as T[]
        }

        protected _serialize(source: T[], serializer: Serializer) {
            const handle = serializer.createArray()

            for (const value of source) {
                const serializedValue = this.elementType["_serialize"](value, serializer)
                serializer.addArrayElement(handle, serializedValue)
            }

            return handle
        }

        protected _deserialize(handle: any, deserializer: Deserializer) {
            const result: any[] = []

            const arrayHandle = deserializer.parseArray(handle)
            if (arrayHandle == null) throw new DeserializationError("Expected " + this.definition)

            let index = -1
            for (const value of deserializer.getArrayElements(arrayHandle)) {
                index++
                let deserializedValue: any

                try {
                    deserializedValue = this.elementType["_deserialize"](value, deserializer)
                } catch (err) {
                    if (err instanceof DeserializationError) {
                        err.appendPath(index.toString())
                    }

                    throw err
                }

                result.push(deserializedValue)
            }

            return result as T[]
        }

        public verify(value: unknown) {
            if (typeof value != "object" || value == null || !Array.isArray(value)) throw new DeserializationError("Expected " + this.definition)

            let index = -1
            for (const element of value) {
                index++
                try {
                    this.elementType.verify(element)
                } catch (err) {
                    if (err instanceof DeserializationError) err.appendPath(index.toString())
                    throw err
                }
            }

            return value as T[]
        }

        constructor(
            public readonly elementType: Type<T>
        ) { super() }
    }

    /** Creates a definition of an array from the provided element type. */
    export function array<T>(element: Type<T>) { return new ArrayType(element) }



    const IS_MAP = Symbol.for("struct.isMap")
    /** Predicate for testing if a {@link Type} is an {@link MapType} */
    export const isMap = (type: Type): type is MapType<any, any> => IS_MAP in type
    /** Type definition for arrays, do not use this class directly, instead use {@link Type.map} factory function. */
    export class MapType<K, V> extends Type<Map<K, V>> {
        public name = `Map<${this.keyType.name}, ${this.valueType.name}>`
        public readonly [IS_MAP] = true

        public getDefinition(indent: string) {
            return indent + `Map<${this.keyType.definition}, ${this.valueType.definition}>`
        }

        public default() {
            return new Map<K, V>()
        }

        protected _serialize(source: Map<K, V>, serializer: Serializer) {
            const handle = serializer.createMap()

            for (const [key, value] of source) {
                const serializedKey = this.keyType["_serialize"](key, serializer)
                const serializedValue = this.valueType["_serialize"](value, serializer)
                serializer.addMapProperty(handle, serializedKey, serializedValue)
            }

            return handle
        }

        protected _deserialize(handle: any, deserializer: Deserializer) {
            const result = new Map<K, V>()

            const mapHandle = deserializer.parseMap(handle)
            if (mapHandle == null) throw new DeserializationError("Expected " + this.definition)

            let index = -1
            for (const [key, value] of deserializer.getMapProperties(mapHandle)) {
                index++
                let deserializedKey: any
                let deserializedValue: any

                try {
                    deserializedKey = this.keyType["_deserialize"](key, deserializer)
                } catch (err) {
                    if (err instanceof DeserializationError) {
                        err.appendPath(index.toString())
                    }

                    throw err
                }

                try {
                    deserializedValue = this.valueType["_deserialize"](value, deserializer)
                } catch (err) {
                    if (err instanceof DeserializationError) {
                        err.appendPath(deserializedKey.toString())
                    }

                    throw err
                }

                result.set(deserializedKey, deserializedValue)
            }

            return result
        }

        public verify(value: unknown): Map<K, V> {
            if (typeof value != "object" || value == null || !(value instanceof Map)) throw new DeserializationError("Expected " + this.definition)

            let index = -1
            for (const [key, element] of value) {
                index++
                try {
                    this.keyType.verify(key)
                } catch (err) {
                    if (err instanceof DeserializationError) err.appendPath(index.toString())
                    throw err
                }

                try {
                    this.valueType.verify(element)
                } catch (err) {
                    if (err instanceof DeserializationError) err.appendPath(key.toString())
                    throw err
                }
            }

            return value
        }

        constructor(
            public readonly keyType: Type<K>,
            public readonly valueType: Type<V>
        ) { super() }
    }

    /**
     * Creates a definition of an map from the provided key and value types.
     * If no key or value are provided, {@link Type.string} is used. When
     * using the default {@link PlainObjectSerializer}, any key types except
     * `string` will cause deserialization to fail.
     * */
    export function map<V, K = string>(value: Type<V>, key?: Type<K>): MapType<K, V>
    export function map(value: Type, key?: Type) {
        return new MapType(key ?? string, value)
    }



    export interface Migration {
        version: number
        desc: string
        migrate: (handle: unknown, deserializer: Deserializer, overrides: Map<string, any>) => any
    }

    export interface Migrations {
        currVersion: number
        list: Migration[]
    }

    const IS_OBJECT = Symbol.for("struct.isObject")
    /** 
     * Type definition for objects. Do not use this class directly, instead use {@link Type.object} or {@link Type.objectWithClass}.
     * The definitions of properties are type-erased, only the resulting type is available. Typically an instance of {@link Type.TypedObjectType} 
     * is returned from factory functions, which keeps this information. This class is used only to represent types of definitions of objects when
     * this information is not available, but we know the definition is of an object, like for example in the case of {@link Type.isObject}.
     * */
    export class ObjectType<T extends object = any> extends Type<T> {
        public readonly propList = Object.entries(this.props)
        public readonly [IS_OBJECT] = true

        protected _migrations: Migrations | null = null

        public getDefinition(indent: string) {
            const result: string[] = []
            result.push(indent + this.name + " " + "{")
            const nextIndent = indent + "    "
            for (const [key, type] of this.propList) {
                result.push(`${nextIndent}${key}: ${type.definition}`)
            }
            result.push(indent + "}")
            return result.join("\n")
        }

        public default(): T {
            const result = this._makeBase()
            for (const [key, value] of this.propList) {
                (result as any)[key] = value.default()
            }
            return result
        }

        protected _serialize(source: T, serializer: Serializer): unknown {
            const handle = serializer.createObject()

            if (this._migrations) {
                serializer.addObjectProperty(handle, "!version", serializer.createPrimitive(this._migrations.currVersion))
            }

            for (const [key, type] of this.propList) {
                const value = (source as any)[key]

                if (Type.isNullable(type) && type.skipNullSerialize && value == null) {
                    continue
                }

                const valueHandle = type["_serialize"](value, serializer)
                serializer.addObjectProperty(handle, key, valueHandle)
            }

            return handle
        }

        /** Creates an object to assign properties to during deserialization. It should be overridden when deserializing classes. */
        protected _makeBase() {
            return {} as T
        }

        protected _deserialize(handle: any, deserializer: Deserializer): T {
            const result = this._makeBase()

            const objectHandle = deserializer.parseObject(handle)
            if (objectHandle == null) throw new DeserializationError("Expected " + this.definition)

            if (this._migrations != null) {
                const currVersion = this._migrations.currVersion

                const sourceVersionHandle = deserializer.getObjectProperty(objectHandle, "!version")

                let sourceVersion: number
                if (deserializer.isNull(sourceVersionHandle)) {
                    sourceVersion = -1
                } else {
                    try {
                        sourceVersion = number["_deserialize"](sourceVersionHandle, deserializer)
                    } catch (err) {
                        if (err instanceof DeserializationError) err.appendPath("!version")
                        throw err
                    }
                }

                let overrides: Map<string, any> | undefined = undefined
                if (sourceVersion < currVersion) {
                    overrides = new Map()
                    const migrationStart = this._migrations.list.findIndex(v => v.version > sourceVersion)
                    if (migrationStart == -1) throw new Error("Cannot perform migration, source version is less than current version but there are no migrations newer than source version")

                    for (let i = migrationStart; i < this._migrations.list.length; i++) {
                        const migration = this._migrations.list[i]
                        migration.migrate(objectHandle, deserializer, overrides)
                    }
                }

                this._apply(result, objectHandle, deserializer, overrides)
            } else {
                this._apply(result, objectHandle, deserializer)
            }

            return result
        }

        protected _apply(receiver: T, handle: any, deserializer: Deserializer, overrides?: Map<string, any>) {
            for (const [key, type] of this.propList) {
                if (overrides != undefined && overrides.has(key)) {
                    (receiver as any)[key] = overrides.get(key)
                    continue
                }

                const valueHandle = deserializer.getObjectProperty(handle, key)

                let value: any
                try {
                    value = type["_deserialize"](valueHandle, deserializer)
                } catch (err) {
                    if (err instanceof DeserializationError) {
                        err.appendPath(key)
                    }
                    throw err
                }
                (receiver as any)[key] = value
            }
        }

        public defineMigrations(migrations: Migration[]) {
            if (migrations.length == 0) return
            migrations = migrations.sort((a, b) => a.version - b.version)
            const currVersion = migrations[migrations.length - 1].version
            this._migrations = { currVersion, list: migrations }
        }

        public verify(value: unknown) {
            if (typeof value != "object" || value == null) throw new DeserializationError("Expected " + this.definition)

            for (const [key, type] of this.propList) {
                try {
                    type.verify((value as Record<string, any>)[key])
                } catch (err) {
                    if (err instanceof DeserializationError) err.appendPath(key)
                    throw err
                }
            }

            return value as T
        }

        constructor(
            public readonly name: string,
            public readonly props: Record<string, Type>
        ) { super() }
    }

    /** Type definition for objects with statically known properties, see {@link Type.ObjectType}. Do not use this class directly, instead use {@link Type.object} or {@link Type.objectWithClass}. */
    export class TypedObjectType<T extends Record<string, Type>> extends ObjectType<Type.ResolveObjectType<T>> {
        constructor(
            name: string,
            public readonly props: T
        ) { super(name, props) }
    }

    /** Creates a definition of an object from the provided record of properties. */
    export function object<T extends Record<string, Type>>(props: T) { return new TypedObjectType("$anon", props) }

    /** Creates a definition of an object from the provided record of properties. */
    export function namedType<T extends Record<string, Type>>(name: string, props: T) { return new TypedObjectType(name, props) }

    /** Creates a definition of an object from the provided record of properties and a specified constructor. There is not test if the specified properties match the specified class. */
    export function objectWithClass<T extends object>(ctor: new () => T, name: string, props: Record<string, Type>): ObjectType<T> {
        return new class ObjectWithClass extends ObjectType<T> {
            public _makeBase(): T {
                return new ctor()
            }

            constructor() {
                super(name, props)
            }
        }
    }

    /** Predicate for testing if a {@link Type} is an {@link ObjectType} */
    export const isObject = (type: Type): type is ObjectType<any> => IS_OBJECT in type

    /** Creates a partial object type from an object type. */
    export const partial = <T extends object>(type: ObjectType<T>) => {
        return new ObjectType<Partial<T>>("Partial<" + type.name + ">", Object.fromEntries(type.propList.map(([key, value]) => [key, isNullable(value) ? value : Type.nullable(value)])))
    }

    /** Creates a new object type that contains only the specified properties. */
    export function pick<T extends object, K extends keyof T>(type: ObjectType<T>, ...picks: K[]) {
        return new ObjectType<Pick<T, K>>("$anon", Object.fromEntries(picks.map(key => [key, type.props[key as string]] as const)))
    }

    /** Creates a new object type that contains all except the specified properties. */
    export function omit<T extends object, K extends keyof T>(type: ObjectType<T>, ...omits: K[]) {
        return new ObjectType<Omit<T, K>>("$anon", Object.fromEntries(omits.map(key => [key, type.props[key as string]] as const)))
    }



    const IS_NULLABLE = Symbol.for("struct.isNullable")
    /** Predicate for testing if a {@link Type} is an {@link NullableType}. */
    export const isNullable = (type: Type): type is NullableType<any> => IS_NULLABLE in type
    /** Type definition for nullable values. Do not use this class directly, instead use {@link Type.nullable}. */
    export class NullableType<T> extends Type<T | null> {
        public readonly name = this.base.name + " | " + null
        public readonly [IS_NULLABLE] = true

        public getDefinition(indent: string): string {
            return this.base.getDefinition(indent) + " | " + null
        }
        public default(): T | null {
            return null
        }
        protected _serialize(source: T | null, serializer: Serializer) {
            if (source == null) {
                return serializer.createNull()
            }

            return this.base["_serialize"](source, serializer)
        }

        protected _deserialize(handle: any, deserializer: Deserializer): T | null {
            if (deserializer.isNull(handle)) return null

            return this.base["_deserialize"](handle, deserializer)
        }

        public verify(value: unknown): T | null {
            if (value == null) return null
            return this.base.verify(value)
        }

        constructor(
            public readonly base: Type<T>,
            public readonly skipNullSerialize: boolean
        ) { super() }
    }
    /** Creates a definition of a nullable value from the provided base type. When `skipNullSerialize` is set, objects will not store this value if it is `null`. */
    export function nullable<T>(base: Type<T>, { skipNullSerialize = false } = {}) {
        return new NullableType(base, skipNullSerialize)
    }

    const IS_OPTIONAL = Symbol.for("struct.isOptional")
    /** Predicate for testing if a {@link Type} is an {@link OptionalType}. */
    export const isOptional = (type: Type): type is OptionalType<any> => IS_OPTIONAL in type
    /** Type definition for optional values. Do not use this class directly, instead use {@link Type.optional}. */
    export class OptionalType<T> extends Type<T> {
        public readonly name = this.base.name
        public readonly [IS_OPTIONAL] = true

        public getDefinition(indent: string): string {
            return this.base.getDefinition(indent)
        }
        public default(): T {
            return this.defaultFactory == null ? this.base.default() : this.defaultFactory()
        }
        protected _serialize(source: T, serializer: Serializer) {
            return this.base["_serialize"](source, serializer)
        }

        protected _deserialize(handle: any, deserializer: Deserializer): T {
            if (deserializer.isNull(handle)) return this.default()

            return this.base["_deserialize"](handle, deserializer)
        }

        public verify(value: unknown): T {
            return this.base.verify(value)
        }

        constructor(
            public readonly base: Type<T>,
            public readonly defaultFactory: (() => T) | null
        ) { super() }
    }
    /** 
     * Creates a definition of a optional value from the provided base type. When the value is missing during deserialization,
     * instead of an error, the default value will be returned. Use the `defaultFactory` override the default value.
     * */
    export function optional<T>(base: Type<T>, defaultFactory?: () => T) {
        return new OptionalType(base, defaultFactory ?? null)
    }



    const IS_PASSTHROUGH = Symbol.for("struct.isPassthrough")
    /** Predicate for testing if a {@link Type} is an {@link PassthroughType}. */
    export const isPassthrough = (type: Type): type is PassthroughType<any> => IS_PASSTHROUGH in type
    /**
     * Type definition for a value that will not be touched during the (de)serialization process. No type-checking is performed
     * and what happens to it is up to the (de)serializer. Do not use this class directly, instead use {@link Type.passthrough} or {@link Type.any}.
     * */
    export class PassthroughType<T> extends Type<T> {
        public readonly [IS_PASSTHROUGH] = true

        public getDefinition(indent: string): string {
            return indent + this.name
        }

        public default(): T {
            return this.defaultFactory()
        }

        protected _serialize(source: T, serializer: Serializer): unknown {
            return serializer.createAny(source)
        }

        protected _deserialize(handle: any, deserializer: Deserializer): T {
            return deserializer.parseAny(handle)
        }

        public verify(value: unknown) {
            return value as T
        }

        constructor(
            public readonly name: string,
            public readonly defaultFactory: () => T
        ) { super() }
    }

    /**
     * Type definition for a value that will not be touched during the (de)serialization process. No type-checking is performed
     * and what happens to it is up to the (de)serializer. If no `defaultFactory` is provided an error is thrown when a default value
     * is generated.
     **/
    export function passthrough<T>(defaultFactory?: T | (() => T), name = "passthrough") {
        if (defaultFactory != null && typeof defaultFactory != "function") {
            const value = defaultFactory
            defaultFactory = () => value
        }
        return new PassthroughType<T>(name, (defaultFactory as () => T) ?? (() => { throw new Error("Cannot create a default value of " + name) }))
    }

    /**
    * Type definition for a value that will not be touched during the (de)serialization process. No type-checking is performed
    * and what happens to it is up to the (de)serializer. If you want to specify a compile-time type use {@link Type.passthrough}
    **/
    export const any = passthrough<any>("any")



    const IS_ENUM = Symbol.for("struct.isEnum")

    /** Predicate for testing if a {@link Type} is an {@link EnumType}. */
    export const isEnum = (type: Type): type is EnumType<any> => IS_ENUM in type

    /**
     * Type definition for enums. An enum can be one of a select set of primitive values. Do not use this class directly instead use {@link Type.enum}.
     * */
    export class EnumType<T extends string | number | boolean> extends Type<T> {
        public readonly name = this.entries.join(" | ")
        public readonly [IS_ENUM] = true

        protected readonly _entries = new Set(this.entries)

        public getDefinition(indent: string): string {
            return indent + this.name
        }

        public default(): T {
            return this.entries[0]
        }

        protected _serialize(source: T, serializer: Serializer): unknown {
            return serializer.createPrimitive(source)
        }

        protected _deserialize(handle: any, deserializer: Deserializer): T {
            const deserializedValue = deserializer.parsePrimitive(handle) as T

            if (!this._entries.has(deserializedValue)) {
                throw new DeserializationError("Expected " + this.name)
            }

            return deserializedValue
        }

        public verify(value: unknown): T {
            if (!this._entries.has(value as T)) throw new DeserializationError("Expected " + this.name)
            return value as T
        }

        constructor(
            public readonly entries: readonly T[]
        ) { super() }
    }

    /** Creates a type representing one of the elements in the lookup map or function. Only the value of the key property is stored and during deserialization it is looked up. */
    export const byKeyProperty = <T>(name: string, key: keyof T, lookup: ReadonlyMap<string, T> | ((key: string) => T | null | undefined), defaultFactory: () => T | null | undefined) => {
        return new class extends Type<T> {
            public readonly name = name

            public getDefinition(indent: string): string {
                return indent + this.name
            }

            public default() {
                return defaultFactory()!
            }

            protected _serialize(source: any, serializer: Serializer): unknown {
                return string["_serialize"](source[key], serializer)
            }

            protected _deserialize(handle: any, deserializer: Deserializer) {
                let id: string
                try {
                    id = string["_deserialize"](handle, deserializer)
                } catch (err) {
                    if (err instanceof DeserializationError) throw new DeserializationError("Expected " + this.name)
                    throw err
                }

                const value = typeof lookup == "function" ? lookup(id) : lookup.get(id)
                if (value == null) throw new DeserializationError(`Invalid ${name} ${key.toString()} "${id}"`)
                return value
            }

            public verify(value: unknown) {
                if (typeof value != "object" || value == null || !(key in value)) throw new DeserializationError("Expected " + this.name)
                const id = (value as any)[key]
                const expected = typeof lookup == "function" ? lookup(id) : lookup.get(id)
                if (expected == null) throw new DeserializationError(`Invalid ${name} ${key.toString()} "${id}"`)
                if (expected != value) throw new DeserializationError(`Invalid ${name} ${id}, ${key.toString()} matches but the value does not equal`)
                return value as T
            }
        } as Type<T>
    }

    /**
     * Creates a type definition that represents a TypeScript union of objects, which is discriminated by a key property.
     * It is not recommended to use this function, instead design your types to use {@link PolymorphicSerializer}.
     * */
    export const byKeyUnion = <T, K extends keyof T>(name: string, key: K, lookup: Record<_Extract<T[K], string>, T extends infer U ? Type<U> : never>, defaultFactory: () => T | null) => {
        const _lookup = new Map(Object.entries(lookup)) as Map<string, Type>
        return new class extends Type<T> {
            public readonly name = name

            public getDefinition(indent: string): string {
                return indent + name
            }

            public default(): T {
                return defaultFactory()!
            }

            protected _serialize(source: T, serializer: Serializer): unknown {
                const id = source[key] as any as string
                const type = _lookup.get(id)
                if (type == null) throw new DeserializationError(`Invalid ${name} ${key.toString()} "${id}"`)
                return type["_serialize"](source, serializer)
            }

            protected _deserialize(handle: any, deserializer: Deserializer): T {
                const objectHandle = deserializer.parseObject(handle)
                if (objectHandle == null) throw new DeserializationError("Expected " + this.definition)
                const keyHandle = deserializer.getObjectProperty(objectHandle, key.toString())

                let id: string
                try {
                    id = string["_deserialize"](keyHandle, deserializer)
                } catch (err) {
                    if (err instanceof DeserializationError) err.appendPath(key.toString())
                    throw err
                }

                const type = _lookup.get(id)
                if (type == null) throw new DeserializationError(`Invalid ${name} ${key.toString()} "${id}"`)
                return type["_deserialize"](objectHandle, deserializer)
            }

            public verify(value: unknown): T {
                if (typeof value != "object" || value == null || !(key in value)) throw new DeserializationError("Expected " + this.name)
                const id = (value as any)[key]
                const expected = _lookup.get(id)
                if (expected == null) throw new DeserializationError(`Invalid ${name} ${key.toString()} "${id}"`)
                return expected.verify(value)
            }
        } as Type<T>
    }

    /** Creates a new type with a custom default value. */
    export function withDefault<T>(type: Type<T>, defaultFactory: () => T) {
        const ctor = type.constructor as { new(): any }

        class TypeWithDefault extends ctor {
            public default() {
                return defaultFactory()
            }
        }

        return type.derive(TypeWithDefault.prototype)
    }
}

/**
 * Creates a definition of an enum from the provided possible values. An enum can be one of a select set of primitive values.
 **/
function enum_1<T extends (string | boolean | number)[]>(...entries: T) {
    return new Type.EnumType<T[number]>(entries)
}

type _Enum = typeof enum_1
declare module "./Type" {
    export namespace Type {
        const _enum: _Enum
        export { _enum as enum }
    }
}

Type.enum = enum_1
