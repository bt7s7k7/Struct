
function makeType<T>(values: Omit<Type<any>, "as" | "definition">): Type<T> {
    return Object.assign({
        as(typeFactory) {
            return typeFactory(this as Type<any>)
        },
        get definition() {
            const definition = this.getDefinition("")

            Object.defineProperty(this, "definition", { value: definition })

            return definition
        }
    } as Pick<Type<any>, "as" | "definition"> & ThisType<Type<any>>, values)
}

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
            if (options.check?.(source) ?? typeof source != type) throw new SerializationError("Expected " + this.getDefinition(""))
            return source
        }
    })
}

export interface Type<T> {
    name: string
    definition: string
    getDefinition(indent: string): string
    default(): T
    as<R>(typeFactory: (type: Type<T>) => R): R
    serialize(source: T): any
    deserialize(source: any): T
}

function makeObject<T extends Record<string, Type<any>>>(name: string, props: T) {
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
                SerializationError.catch(key, () => ret[key] = value.serialize(source[key]))
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

const IS_ARRAY = Symbol("isArray")
const IS_RECORD = Symbol("isRecord")
const IS_STRING_UNION = Symbol("isRecord")
const IS_OBJECT = Symbol("isObject")
const IS_NULLABLE = Symbol("isNullable")

export interface TypeValuePair {
    type: Type<any>
    value: any
}

export class SerializationError extends Error {
    public appendPath: (path: string) => void

    public path = ""

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

export namespace Type {

    export const isArray = (type: Type<any>): type is ArrayType<any> => IS_ARRAY in type
    export const isRecord = (type: Type<any>): type is RecordType<any> => IS_RECORD in type
    export const isStringUnion = (type: Type<any>): type is StringUnionType<any> => IS_STRING_UNION in type
    export const isObject = (type: Type<any>): type is ObjectType => IS_OBJECT in type
    export const isNullable = (type: Type<any>): type is NullableType<any> => IS_NULLABLE in type

    export interface ArrayType<T = any> extends Type<T[]> {
        [IS_ARRAY]: true
        type: Type<T>
    }

    export interface RecordType<T = any> extends Type<Record<string, T>> {
        [IS_RECORD]: true
        type: Type<T>
    }

    export interface StringUnionType<T = string> extends Type<T> {
        [IS_STRING_UNION]: true
        entries: string[]
    }

    export interface ObjectType<T extends Record<string, Type<any>> = Record<string, Type<any>>> extends Type<ResolveObjectType<T>> {
        [IS_OBJECT]: true
        props: T
        propList: [string, Type<any>][]
    }

    export interface NullableType<T = any> extends Type<T | null> {
        [IS_NULLABLE]: true
        base: Type<T>
    }

    export type GetTypeFromTypeWrapper<T extends Type<any>> = T extends Type<infer U> ? U : never
    export type ResolveObjectType<T extends Record<string, Type<any>>> = {
        [P in keyof T]: GetTypeFromTypeWrapper<T[P]>
    }

    export const number = makePrimitive<number>("number", { default: 0 })
    export const string = makePrimitive<string>("string", { default: "" })
    export const boolean = makePrimitive<boolean>("boolean", { default: false })
    export const empty = makePrimitive<void>("empty", { default: null as unknown as void, check: v => v == null })

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
                SerializationError.catch(key, () => ret[key] = type.serialize(value as any))
            }

            return ret
        },
        [IS_RECORD]: true,
        type
    })

    export const stringUnion = <T extends string[]>(...entries: T) => {
        const entriesLookup = new Set(entries)

        return extendType<Type.StringUnionType<T[number]>, T[number]>({
            name: entries.join(" | "),
            getDefinition() { return this.name },
            default: () => entries[0],
            serialize: v => v,
            [IS_STRING_UNION]: true,
            deserialize(source) {
                if (typeof source != "string" || !entriesLookup.has(source)) throw new SerializationError("Expected " + this.getDefinition(""))

                return source
            },
            entries
        })
    }

    export const namedType = makeObject

    export const object = <T extends Record<string, Type<any>>>(props: T) => {
        return makeObject("__anon", props)
    }

    export const nullable = <T>(type: Type<T>) => extendType<Type.NullableType<T>, T | null>({
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
        base: type
    })

    export const recursive = <T extends any>(thunk: () => Type<T>): Type<T> => {
        let instance: Type<T> | null = null

        return {
            as(f) {
                if (!instance) instance = thunk()
                return instance.as(f)
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
}
