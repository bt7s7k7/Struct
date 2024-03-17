function makeType<T>(options: Omit<Type<any>, "as" | "definition" | "getDefinition"> & Partial<Pick<Type<any>, "getDefinition">>): Type<T> {
    const result = Object.assign({
        as(typeFactory, ...args) {
            return typeFactory(this as Type<any>, ...args)
        },
        getDefinition(indent) {
            return indent + this.name
        }
    } as Pick<Type<any>, "as" | "definition" | "getDefinition"> & ThisType<Type<any>>, options) as Type<T>

    Object.defineProperty(result, "definition", {
        get(this: typeof result) {
            const definition = this.getDefinition("")

            Object.defineProperty(this, "definition", { value: definition })

            return definition
        },
        configurable: true
    })

    return result
}

type _Extract<T, U> = Extract<T, U>

function makePrimitive<T>(type: string, options: {
    default: T,
    check?: (v: any) => boolean
}) {
    return makeType<T>({
        name: type,
        default: () => options.default,
        getDefinition: () => type,
        serialize: v => v,
        deserialize(source) {
            if (options.check ? !options.check(source) : typeof source != type) throw new SerializationError("Expected " + (this as Type<T>).getDefinition(""))
            return source
        }
    })
}

export interface Type<T> {
    name: string
    definition: string
    getDefinition(indent: string): string
    default(): T
    as<R, A extends any[]>(typeFactory: (type: Type<T>, ...args: A) => R, ...args: A): R
    serialize(source: T): any
    deserialize(source: any): T
}

function makeObject<T extends Record<string, Type<any>>>(name: string, props: T) {
    props = Object.assign(Object.create(null), props)

    const propList = Object.entries(props)

    const isAnon = name == "__anon"

    return extendType<Type.ObjectType<T>, Type.ResolveObjectType<T>>({
        name,
        default: () => {
            return Object.fromEntries(propList.map(([key, value]) => ([key, value.default()]))) as any
        },
        getDefinition(indent) {
            if (!isAnon && indent != "") {
                return this.name
            }

            const lines: string[] = []

            if (isAnon) lines.push("{")
            else lines.push(`${name} {`)

            const nextIndent = indent + "  "
            for (const prop of propList) {
                lines.push(nextIndent + prop[0] + ": " + prop[1].getDefinition(nextIndent))
            }

            lines.push(indent + "}")

            return lines.join("\n")
        },
        serialize(source) {
            const ret: Record<string, any> = {}

            for (const [key, value] of propList) {
                if (Type.isNullable(value) && value.skipNullSerialize && (source as any)[key] == null) {
                    continue
                }

                SerializationError.catch(key, () => ret[key] = value.serialize((source as any)[key]))
            }

            return ret
        },
        deserialize(source) {
            const ret: Record<string, any> = {}

            if (!source || typeof source != "object" || source instanceof Array) throw new SerializationError("Expected " + this.getDefinition(""))

            for (const [key, value] of propList) {
                SerializationError.catch(key, () => ret[key] = value.deserialize(source[key]))
            }

            return ret as Type.ResolveObjectType<T>
        },
        [IS_OBJECT]: true,
        props, propList
    })
}

function extendType<I extends Type<T>, T>(values: Omit<I, "as" | "definition">): I {
    return makeType<T>(values) as I
}

const IS_ARRAY = Symbol.for("struct.isArray")
const IS_SET = Symbol.for("struct.isSet")
const IS_MAP = Symbol.for("struct.isMap")
const IS_RECORD = Symbol.for("struct.isRecord")
const IS_STRING_UNION = Symbol.for("struct.isStringUnion")
const IS_OBJECT = Symbol.for("struct.isObject")
const IS_NULLABLE = Symbol.for("struct.isNullable")
const IS_OPTIONAL = Symbol.for("struct.isOptional")
const IS_KEY_VALUE_PAIR = Symbol.for("struct.isKeyValuePair")
const METADATA = Symbol.for("struct.metadata")

export interface TypeValuePair {
    type: Type<any>
    value: any
}

export class SerializationError extends Error {
    public appendPath: (path: string) => void

    public path = ""

    public readonly _isClientError = true

    constructor(
        message: string
    ) {
        super("__MSG")

        const oldMessage = this.message
        const oldStack = this.stack ?? ""

        const setPath = (newPath: string) => {
            const newMessage = `Invalid type at .${this.path} : ${message}`
            this.message = oldMessage.replace(/__MSG/, newMessage)
            this.stack = oldStack.replace(/__MSG/, newMessage)
        }

        this.appendPath = (newPath) => {
            this.path = `${newPath}${this.path ? `.${this.path}` : this.path}`
            setPath(newPath)
        }

        setPath(this.path)
    }

    public static catch<T>(path: string, thunk: () => T): T {
        try {
            return thunk()
        } catch (err) {
            if (err instanceof SerializationError) {
                err.appendPath(path)
            }

            throw err
        }
    }
}

type NullablePartial<
    T,
    NK extends keyof T = { [K in keyof T]: null extends T[K] ? K : never }[keyof T],
    NP = Partial<Pick<T, NK>> & Pick<T, Exclude<keyof T, NK>>
> = { [K in keyof NP]: NP[K] }

type GetTaggedUnionTypes<T extends Record<string, Type<any>>> = {
    [P in keyof T]: Type.Extract<T[P]> extends void ? { type: P, value?: null } : { type: P, value: Type.Extract<T[P]> }
}[keyof T]

export namespace Type {
    export const createType = makeType

    export const isArray = (type: Type<any>): type is ArrayType<any> => IS_ARRAY in type
    export const isSet = (type: Type<any>): type is SetType<any> => IS_SET in type
    export const isMap = (type: Type<any>): type is MapType<any> => IS_MAP in type
    export const isRecord = (type: Type<any>): type is RecordType<any> => IS_RECORD in type
    export const isEnum = (type: Type<any>): type is EnumType<any> => IS_STRING_UNION in type
    export const isObject = (type: Type<any>): type is ObjectType => IS_OBJECT in type
    export const isNullable = (type: Type<any>): type is NullableType<any> => IS_NULLABLE in type
    export const isOptional = (type: Type<any>): type is OptionalType<any> => IS_OPTIONAL in type
    export const isKeyValuePair = (type: Type<any>): type is KeyValuePair<any> => IS_KEY_VALUE_PAIR in type
    export const isType = (value: unknown): value is Type<any> => (
        (typeof value == "object" || typeof value == "function") && value != null
        && "serialize" in value && "deserialize" in value
        && "name" in value && "default" in value && "as" in value
    )

    export function getMetadata(type: Type<any>) {
        if (METADATA in type) {
            return type[METADATA] as {
                get<T extends new (...args: any) => any>(type: T): InstanceType<T> | undefined
                has(type: new (...args: any) => any): boolean
                [Symbol.iterator](): IterableIterator<[new (...args: any) => any, any]>
            }
        } else {
            return null
        }
    }

    export interface ArrayType<T = any> extends Type<T[]> {
        [IS_ARRAY]: true
        type: Type<T>
    }

    export interface SetType<T = any> extends Type<Set<T>> {
        [IS_SET]: true
        type: Type<T>
    }

    export interface MapType<T = any> extends Type<Map<string, T>> {
        [IS_MAP]: true
        type: Type<T>
    }

    export interface RecordType<T = any> extends Type<Record<string, T>> {
        [IS_RECORD]: true
        type: Type<T>
    }

    export interface EnumType<T = string> extends Type<T> {
        [IS_STRING_UNION]: true
        entries: T[]
    }

    export interface ObjectType<T extends Record<string, Type<any>> = Record<string, Type<any>>> extends Type<ResolveObjectType<T>> {
        [IS_OBJECT]: true
        props: T
        propList: [string, Type<any>][]
    }

    export interface NullableType<T = any> extends Type<T | null> {
        [IS_NULLABLE]: true
        base: Type<T>
        skipNullSerialize: boolean
    }

    export interface OptionalType<T = any> extends Type<T> {
        [IS_OPTIONAL]: true
        base: Type<T>
    }

    export interface TaggedUnionType<T extends Record<string, Type<any>>> extends Type<GetTaggedUnionTypes<T>> {
        types: T,
        typeList: { [P in keyof T]: [P, T[P]] }[keyof T][]
    }

    type MakeKeyValueOptions<T extends Record<string, Type<any>>> = {
        [P in keyof T]: { key: P, value: Extract<T[P]> }
    }[keyof T]
    export interface KeyValuePair<T extends Record<string, Type<any>>> extends Type<MakeKeyValueOptions<T>> {
        [IS_KEY_VALUE_PAIR]: true,
        base: ObjectType<T>
        make<F extends MakeKeyValueOptions<T>>(value: F): F
    }

    export type Extract<T extends Type<any>> = T extends Type<infer U> ? U : never
    /** @deprecated Use `Type.Extract` */
    export type GetTypeFromTypeWrapper<T extends Type<any>> = Type.Extract<T>
    export type ResolveObjectType<T extends Record<string, Type<any>>> = NullablePartial<{
        [P in keyof T]: Extract<T[P]>
    }>

    export const number = makePrimitive<number>("number", { default: 0 })
    export const string = makePrimitive<string>("string", { default: "" })
    export const boolean = makePrimitive<boolean>("boolean", { default: false })
    export const empty = makePrimitive<void>("empty", { default: null as unknown as void, check: v => (v == null || v == "") })

    export const array = <T>(type: Type<T>) => extendType<Type.ArrayType<T>, T[]>({
        name: type.name + "[]",
        default: () => [],
        getDefinition(indent) {
            return type.getDefinition(indent) + "[]"
        },
        serialize(source) {
            const ret: any[] = []

            for (let i = 0, len = source.length; i < len; i++) {
                const entry = source[i]
                SerializationError.catch(`[${i}]`, () => ret.push(type.serialize(entry)))
            }

            return ret
        },
        deserialize(source) {
            const ret: any[] = []

            if (!(source instanceof Array)) throw new SerializationError("Expected " + this.getDefinition(""))

            for (let i = 0, len = source.length; i < len; i++) {
                const entry = source[i]
                SerializationError.catch(`[${i}]`, () => ret.push(type.deserialize(entry)))
            }

            return ret
        },
        [IS_ARRAY]: true,
        type
    })

    export const set = <T>(type: Type<T>) => extendType<Type.SetType<T>, Set<T>>({
        name: "Set<" + type.name + ">",
        default: () => new Set(),
        getDefinition(indent) {
            return "Set<" + type.getDefinition(indent) + ">"
        },
        serialize(source) {
            const ret: any[] = []

            let i = 0
            for (const entry of source.values()) {
                SerializationError.catch(`[${i}]`, () => ret.push(type.serialize(entry)))
                i++
            }

            return ret
        },
        deserialize(source) {
            const ret = new Set<T>()

            if (!(source instanceof Array)) throw new SerializationError("Expected " + this.getDefinition(""))

            for (let i = 0, len = source.length; i < len; i++) {
                const entry = source[i]
                SerializationError.catch(`[${i}]`, () => ret.add(type.deserialize(entry)))
            }

            return ret
        },
        [IS_SET]: true,
        type
    })

    export const record = <T>(type: Type<T>) => extendType<Type.RecordType<T>, Record<string, T>>({
        name: type.name + "[:]",
        default: () => ({}),
        getDefinition(indent) {
            return type.getDefinition(indent) + "[:]"
        },
        serialize(source) {
            const ret: Record<string, any> = {}

            for (const [key, value] of Object.entries(source)) {
                SerializationError.catch(key, () => ret[key] = type.serialize(value))
            }

            return ret
        },
        deserialize(source) {
            const ret: Record<string, any> = {}

            if (!source || typeof source != "object" || source instanceof Array) throw new SerializationError("Expected " + this.getDefinition(""))

            for (const [key, value] of Object.entries(source)) {
                SerializationError.catch(key, () => ret[key] = type.deserialize(value as any))
            }

            return ret
        },
        [IS_RECORD]: true,
        type
    })

    export const map = <T>(type: Type<T>) => extendType<Type.MapType<T>, Map<string, T>>({
        name: "Map<" + type.name + ">",
        default: () => new Map(),
        getDefinition(indent) {
            return "Map<" + type.getDefinition(indent) + ">"
        },
        serialize(source) {
            const ret: Record<string, any> = {}

            for (const [key, value] of source) {
                SerializationError.catch(key, () => ret[key] = type.serialize(value))
            }

            return ret
        },
        deserialize(source) {
            const ret = new Map<string, T>()

            if (!source || typeof source != "object" || source instanceof Array) throw new SerializationError("Expected " + this.getDefinition(""))

            for (const [key, value] of Object.entries(source)) {
                SerializationError.catch(key, () => ret.set(key, type.deserialize(value as any)))
            }

            return ret
        },
        [IS_MAP]: true,
        type
    })

    export const stringUnion = <T extends (string | boolean | number)[]>(...entries: T) => {
        const entriesLookup = new Set(entries)

        return extendType<Type.EnumType<T[number]>, T[number]>({
            name: entries.join(" | "),
            getDefinition() { return this.name },
            default: () => entries[0],
            serialize: v => v,
            [IS_STRING_UNION]: true,
            deserialize(source) {
                if (!entriesLookup.has(source)) throw new SerializationError("Expected " + this.getDefinition(""))

                return source
            },
            entries
        })
    }

    export const namedType = makeObject

    export const object = <T extends Record<string, Type<any>>>(props: T) => {
        return makeObject("__anon", props)
    }

    export const objectWithClass = <T extends object>(ctor: new (...args: any[]) => T, name: string, props: Record<string, Type<any>>, options: { default?: () => T } = {}) => {
        const type = makeObject(name, props) as unknown as Type<T>
        if (options.default) {
            type.default = options.default
        } else {
            const oldDefault = type.default
            type.default = () => Object.assign(new ctor(), oldDefault.call(type))
        }
        const oldDeserialize = type.deserialize
        type.deserialize = (source) => {
            return Object.assign(new ctor(), oldDeserialize.call(type, source))
        }

        return type
    }

    export const nullable = <T>(type: Type<T>, { skipNullSerialize = false } = {}) => extendType<Type.NullableType<T>, T | null>({
        name: type.name + "?",
        default: () => null,
        getDefinition(indent) {
            return type.getDefinition(indent) + "?"
        },
        serialize(source) {
            if (source == null) return null
            else return type.serialize(source)
        },
        deserialize(source) {
            if (source == null) return null
            else return type.deserialize(source)
        },
        [IS_NULLABLE]: true,
        base: type, skipNullSerialize
    })

    export const optional = <T>(type: Type<T>, defaultValue: (() => T) | null = null) => extendType<Type.OptionalType<T>, T>({
        ...type,
        deserialize(source) {
            if (source == null) {
                if (defaultValue) {
                    return defaultValue()
                } else {
                    return type.default()
                }
            }

            return type.deserialize(source)
        },
        [IS_OPTIONAL]: true,
        base: type
    })

    export const keyValuePair = <T extends Record<string, Type<any>>>(type: ObjectType<T>) => extendType<Type.KeyValuePair<T>, MakeKeyValueOptions<T>>({
        name: `KeyValuePair<${type.name}>`,
        default: () => { throw new Error("Cannot create default key value pair") },
        getDefinition(indent) {
            return indent + "KeyValuePair<" + type.getDefinition("") + ">"
        },
        serialize(source) {
            const key = source.key
            const prop = type.props[key]
            return { key, value: prop.serialize(source.value) }
        },
        deserialize(source) {
            if (!source || typeof source != "object" || source instanceof Array) throw new SerializationError("Expected " + this.getDefinition(""))

            const key = string.deserialize(source.key)
            if (!(key in type.props)) throw new SerializationError(`"${key}" is not a valid key of ${type.name}`)

            const prop = type.props[key]
            const value = SerializationError.catch("value", () => prop.deserialize(source.value))

            return { key, value }
        },
        [IS_KEY_VALUE_PAIR]: true,
        base: type,
        make(value) {
            return value
        },
    })

    export const partial = <T>(type: Type<T>) => {
        if (!isObject(type)) throw new Error("Partial type must be derived from object")

        return Type.namedType("Partial<" + type.name + ">", Object.fromEntries(type.propList.map(([key, value]) => [key, isNullable(value) ? value : Type.nullable(value)]))) as Type<Partial<T>>
    }

    export const recursive = <T>(thunk: () => Type<T>): Type<T> => {
        let instance: Type<T> | null = null

        return {
            as(f, ...args) {
                if (!instance) instance = thunk()
                return instance.as(f, ...args)
            },
            default() {
                if (!instance) instance = thunk()
                return instance.default()
            },
            get name() {
                if (!instance) instance = thunk()
                return instance.name
            },
            get definition() {
                if (!instance) instance = thunk()
                return instance.definition
            },
            deserialize(f) {
                if (!instance) instance = thunk()
                return instance.deserialize(f)
            },
            serialize(f) {
                if (!instance) instance = thunk()
                return instance.serialize(f)
            },
            getDefinition(f) {
                if (!instance) instance = thunk()
                return instance.getDefinition(f)
            }
        }
    }

    export const ctor = <T>(ctor: { new(): T }) => {
        return makeType<T>({
            default: () => new ctor(),
            deserialize(source) {
                const target = new ctor()

                for (const [key, value] of Object.entries(target as any)) {
                    const targetType = typeof value
                    let sourceValue = source[key]
                    const sourceType = typeof sourceValue

                    if (targetType == "function") continue
                    if (targetType == "bigint" && sourceType == "string") {
                        try {
                            source = BigInt(source)
                        } catch {
                            const err = new SerializationError("Expected string representation of a bigint")
                            err.appendPath(key)
                            throw err
                        }
                    }

                    if (targetType == "symbol") continue

                    if (sourceType != targetType && (targetType != "object" || sourceValue != null) && targetType != "undefined") {
                        const err = new SerializationError("Expected " + targetType)
                        err.appendPath(key)
                        throw err
                    }

                    (target as any)[key] = sourceValue
                }

                return target
            },
            serialize(source) {
                const result: Record<string, any> = {}

                for (let [key, value] of Object.entries(source)) {
                    const type = typeof value

                    if (type == "function") continue
                    if (type == "symbol") continue
                    if (type == "bigint") {
                        value = (value as BigInt).toString()
                    }

                    result[key] = value
                }

                return result
            },
            getDefinition() {
                return this.name
            },
            name: ctor.name
        })
    }

    export function passthrough<T>(defaultValue: T, name = "passthrough") {
        return makeType<T>({
            default: () => defaultValue,
            deserialize(source: any) {
                return source
            },
            serialize(source: any) {
                return source
            },
            getDefinition() {
                return this.name
            },
            name
        })
    }

    export function taggedUnion<T extends Record<string, Type<any>>>(types: T) {
        const typeList = Object.entries(types) as unknown as TaggedUnionType<T>["typeList"]

        const getDefinition = (indent: string) => {
            return typeList.map(v => `${JSON.stringify(v[0])} => ${v[1].getDefinition(indent)}`).join(",\n")
        }

        return extendType<TaggedUnionType<T>, GetTaggedUnionTypes<T>>({
            types, typeList,
            default() {
                return { type: typeList[0][0], value: typeList[0][1].default() }
            },
            getDefinition,
            name: getDefinition(""),
            deserialize(source) {
                const parsedSource = taggedUnionWrapper.deserialize(source)
                const target = types[parsedSource.type]
                if (target == null) throw new SerializationError("Type " + JSON.stringify(parsedSource.type) + " not a valid tag")
                return {
                    type: parsedSource.type,
                    value: target.deserialize(parsedSource.value)
                }
            },
            serialize(source) {
                const target = types[source.type]
                return {
                    type: source.type,
                    value: target.serialize(source.value)
                }
            }
        })
    }

    export const byKeyProperty = <T>(name: string, key: keyof T, lookup: ReadonlyMap<string, T> | ((key: string) => T | null | undefined), defaultFactory: () => T | null | undefined) => {
        return Type.createType<T>({
            name, default: defaultFactory,
            serialize(source: T) {
                return source[key]
            },
            deserialize(source) {
                const id = Type.string.deserialize(source)
                const type = typeof lookup == "function" ? lookup(id) : lookup.get(id)
                if (type == null) throw new SerializationError(`Invalid ${name} ${key.toString()} "${id}"`)
                return type
            }
        })
    }

    export const byKeyUnion = <T, K extends keyof T>(name: string, key: K, lookup: Record<_Extract<T[K], string>, T extends infer U ? Type<U> : never>, defaultFactory: () => T | null) => {
        const _lookup = new Map(Object.entries(lookup)) as Map<string, Type<any>>
        return Type.createType<T>({
            name, default: defaultFactory,
            serialize(source: T) {
                const id = source[key] as any as string
                const type = _lookup.get(id)
                if (type == null) throw new SerializationError(`Invalid ${name} ${key.toString()} "${id}"`)
                return type.serialize(source)
            },
            deserialize(source) {
                if (typeof source != "object" || source == null) throw new SerializationError("Expected " + name)
                const id = Type.string.deserialize(source[key]) as string
                const type = _lookup.get(id)
                if (type == null) throw new SerializationError(`Invalid ${name} ${key.toString()} "${id}"`)
                return type.deserialize(source)
            }
        })
    }

    export function defineMigrations<T extends Type<any>>(type: T, migration: { version: number, desc: string, migrate: (v: any) => any }[]) {
        const currVersion = migration.reduce((p, v) => Math.max(p, v.version), 0)
        const oldSerialize = type.serialize
        type.serialize = function (source) {
            const result = oldSerialize.apply(this, [source])
            result["!version"] = currVersion
            return result
        }

        const oldDeserialize = type.deserialize
        type.deserialize = function (source) {
            let version = source["!version"]
            if (isNaN(version)) version = -1
            const currMigrations = migration.filter(v => v.version > version).sort((a, b) => a.version - b.version)

            for (const migration of currMigrations) {
                source = migration.migrate(source)
            }

            return oldDeserialize.apply(this, [source])
        }
    }

    export function clone<T>(type: Type<T>, value: T) {
        return type.deserialize(type.serialize(value))
    }

    export interface Action<T extends Type<any>, R extends Type<any>> {
        argument: T
        result: R
    }

    export type ActionArgument<T extends Action<Type<any>, Type<any>>> = T extends Action<infer U, any> ? Type.Extract<U> : never
    export type ActionResult<T extends Action<Type<any>, Type<any>>> = T extends Action<any, infer U> ? Type.Extract<U> : never

    export function action<T extends Type<any>, R extends Type<any>>(argument: T, result: R): Action<T, R> {
        return { argument, result }
    }

    export const EMPTY_ACTION = action(empty, empty)

    export function annotate<T extends Type<any>>(type: T, ...metadata: any[]): T {
        const newMetadata = metadata.map(v => [v.constructor, v] as const)
        const existingMetadata = Type.getMetadata(type)
        if (existingMetadata) {
            return { ...type, [METADATA]: new Map([...existingMetadata, ...newMetadata]) }
        } else {
            return { ...type, [METADATA]: new Map(newMetadata) }
        }
    }

    export function withDefault<T extends Type<any>>(type: T, factory: (prev: T["default"]) => ReturnType<T["default"]>): T {
        const prev = type.default
        return { ...type, default: () => factory(prev) }
    }

    export function pick<T, K extends keyof T>(type: Type<T>, ...picks: K[]) {
        if (!Type.isObject(type)) throw new Error("Type.pick must be used on an object type")
        return Type.object(Object.fromEntries(picks.map(key => [key, type.props[key as string]] as const))) as Type<Pick<T, K>>
    }

    export function omit<T, K extends keyof T>(type: Type<T>, ...omits: K[]) {
        if (!Type.isObject(type)) throw new Error("Type.omit must be used on an object type")
        return Type.object(Object.fromEntries(Object.entries(type.props).filter(([key, value]) => !omits.includes(key as any)))) as Type<Omit<T, K>>
    }
}

type _Enum = typeof Type.stringUnion
declare module "./Type" {
    export namespace Type {
        const _enum: _Enum
        export { _enum as enum }
    }
}

Type.enum = Type.stringUnion

const taggedUnionWrapper = Type.object({
    type: Type.string,
    value: Type.passthrough(null as any)
})
