
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
    default: T
}) {
    return makeType<T>({
        name: type,
        default: () => options.default,
        getDefinition: () => type
    })
}

export interface Type<T> {
    name: string
    definition: string
    getDefinition(indent: string): string
    default(): T
    as<R>(typeFactory: (type: Type<T>) => R): R
}

function makeObject<T extends Record<string, Type<any>>>(name: string, props: T) {
    const propList = Object.entries(props)

    const isAnon = name == "__anon"

    return extendType<Type.ObjectType<T>, Type.ResolveObjectType<T>>({
        name,
        default: () => {
            return {} as any
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
        [IS_OBJECT]: true,
        props
    })
}

function extendType<I extends Type<T>, T>(values: Omit<I, "as" | "definition">): I {
    return makeType<T>(values) as I
}

export namespace Type {
    export interface ArrayType<T> extends Type<T[]> {
        [IS_ARRAY]: true
        type: Type<T>
    }

    export interface RecordType<T> extends Type<Record<string, T>> {
        [IS_RECORD]: true
        type: Type<T>
    }

    export interface EnumType<T> extends Type<T> {
        [IS_ENUM]: true
        entries: string[]
    }

    export interface ObjectType<T extends Record<string, Type<any>>> extends Type<ResolveObjectType<T>> {
        [IS_OBJECT]: true
        props: T
    }

    export interface NullableType<T> extends Type<T | null> {
        [IS_NULLABLE]: true
        base: Type<T>
    }

    export type GetTypeFromTypeWrapper<T extends Type<any>> = T extends Type<infer U> ? U : never
    export type ResolveObjectType<T extends Record<string, Type<any>>> = {
        [P in keyof T]: GetTypeFromTypeWrapper<T[P]>
    }
}

const IS_ARRAY = Symbol("isArray")
const IS_RECORD = Symbol("isRecord")
const IS_ENUM = Symbol("isRecord")
const IS_OBJECT = Symbol("isObject")
const IS_NULLABLE = Symbol("isNullable")

export const Type = {
    number: makePrimitive<number>("number", { default: 0 }),
    string: makePrimitive<string>("string", { default: "" }),
    boolean: makePrimitive<boolean>("boolean", { default: false }),
    array: <T>(type: Type<T>) => extendType<Type.ArrayType<T>, T[]>({
        name: type.name + "[]",
        default: () => [],
        getDefinition(indent) {
            return type.getDefinition(indent) + "[]"
        },
        [IS_ARRAY]: true,
        type
    }),
    record: <T>(type: Type<T>) => extendType<Type.RecordType<T>, Record<string, T>>({
        name: type.name + "[:]",
        default: () => ({}),
        getDefinition(indent) {
            return type.getDefinition(indent) + "[:]"
        },
        [IS_RECORD]: true,
        type
    }),
    enum<T extends string[]>(...entries: T) {
        const entriesLookup = new Set(entries)

        return extendType<Type.EnumType<T[number]>, T[number]>({
            name: entries.join(" | "),
            getDefinition() { return this.name },
            default: () => entries[0],
            [IS_ENUM]: true,
            entries
        })
    },
    interface: makeObject,
    object: <T extends Record<string, Type<any>>>(props: T) => {
        return makeObject("__anon", props)
    },
    nullable: <T>(type: Type<T>) => extendType<Type.NullableType<T>, T | null>({
        name: type.name + "?",
        default: () => null,
        getDefinition(indent) {
            return type.getDefinition(indent) + "?"
        },
        [IS_NULLABLE]: true,
        base: type
    })
}
