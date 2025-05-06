import { DeserializationError, Deserializer, DeserializerTypeHint, Serializer, Type } from "./Type"

export class UnionDiscriminationError extends Error {
    name = "UnionDiscriminationError"

    public static unableToDiscriminate(a: Type, b: Type) {
        return new UnionDiscriminationError(`Unable to discriminate between "${a.name}" and "${b.name}"`)
    }
}

export class _UnionTypeMatcher {
    public nullType: Type | null = null
    public addNullType(type: Type) {
        if (this.nullType) throw UnionDiscriminationError.unableToDiscriminate(this.nullType, type)
        this.nullType = type
    }

    public arrayType: Type | null = null
    public addArrayType(type: Type) {
        if (this.arrayType) throw UnionDiscriminationError.unableToDiscriminate(this.arrayType, type)
        this.arrayType = type
    }

    public mapType: Type | null = null
    public addMapType(type: Type) {
        if (this.mapType) throw UnionDiscriminationError.unableToDiscriminate(this.mapType, type)
        this.mapType = type
    }

    public fallbackType: Type | null = null
    public addFallbackType(type: Type) {
        if (this.fallbackType) throw UnionDiscriminationError.unableToDiscriminate(this.fallbackType, type)
        this.fallbackType = type
    }

    public primitives: Map<string, Type> | null = null
    public addPrimitive(name: string, type: Type) {
        this.primitives ??= new Map()
        const existing = this.primitives.get(name)
        if (existing) throw UnionDiscriminationError.unableToDiscriminate(existing, type)
        this.primitives.set(name, type)
    }

    public hints: Map<DeserializerTypeHint, Type> | null = null
    public addHint(name: DeserializerTypeHint, type: Type) {
        this.hints ??= new Map()
        const existing = this.hints.get(name)
        if (existing) throw UnionDiscriminationError.unableToDiscriminate(existing, type)
        this.hints.set(name, type)
    }

    public constants: Map<number | string | boolean, Type> | null = null
    public addConstant(name: number | string | boolean, type: Type) {
        this.constants ??= new Map()
        const existing = this.constants.get(name)
        if (existing) throw UnionDiscriminationError.unableToDiscriminate(existing, type)
        this.constants.set(name, type)
    }

    public discriminator: string | null = null
    public objectTypes: Map<number | string | boolean, Type> | null = null
    public addObjectType(name: number | string | boolean, type: Type) {
        const existing = this.objectTypes!.get(name)
        if (existing) throw UnionDiscriminationError.unableToDiscriminate(existing, type)
        this.objectTypes!.set(name, type)
    }

    public matchValue(value: unknown): Type {
        if (this.nullType && value == null) return this.nullType

        if (this.primitives) {
            const type = this.primitives.get(typeof value)
            if (type) return type
        }

        if (this.constants) {
            const type = this.constants.get(typeof value)
            if (type) return type
        }

        if (this.arrayType && value instanceof Array) return this.arrayType
        if (this.mapType && value instanceof Map) return this.mapType

        if (this.objectTypes && typeof value == "object" && value != null && !(value instanceof Array)) {
            const type = this.objectTypes.get((value as any)[this.discriminator!])
            if (type) return type
        }

        if (this.fallbackType) {
            return this.fallbackType
        }

        throw new DeserializationError("No types in the union match the specified value")
    }

    public matchHandle(handle: any, hint: DeserializerTypeHint, deserializer: Deserializer): Type {
        if (this.nullType && hint == "null") return this.nullType
        if (this.arrayType && hint == "array") return this.arrayType

        if (this.hints) {
            const type = this.hints.get(hint)
            if (type) return type
        }

        if (this.constants && (hint == "string" || hint == "boolean" || hint == "number")) {
            const type = this.constants.get(deserializer.parsePrimitive(handle))
            if (type) return type
        }

        if (this.objectTypes && hint == "object") {
            const constant = deserializer.getObjectProperty(handle, this.discriminator!)
            const type = this.objectTypes.get(constant as any)
            if (type) return type
        }

        if (this.mapType && hint == "object") return this.mapType

        if (this.fallbackType) {
            return this.fallbackType
        }

        throw new DeserializationError("No types in the union match the specified value")
    }
}


/**
 * Union type can be used for serialization of a value that can have multiple types. The matching is optimistic and deterministic using the specified type order -
 * the first type that matches will be used for deserialization. Not all types are supported, matching supports primitive types, nullable and optional types,
 * array and map types (only one array and map type can be used, their element types are not used to discriminate between them) and object types (objects must
 * have at least one enum property with only one possible value to allow for discrimination).
 */
export class UnionType<T> extends Type<T> {
    public get name() { return this.getDefinition("") }
    protected readonly _types: Type<T>[]
    public get types() { return this._types as readonly Type<T>[] }

    protected _matcher: _UnionTypeMatcher | null = null

    protected _prepareMatchers() {
        if (this._matcher) return this._matcher

        const matcher = new _UnionTypeMatcher()
        const objectTypes: Type.ObjectType[] = []
        for (const type of this.types) {
            if (Type.isNullable(type)) {
                matcher.addNullType(type)
                continue
            }

            if (Type.isOptional(type)) {
                matcher.addNullType(type)
                continue
            }

            if (type.name == Type.boolean.name) {
                matcher.addPrimitive("boolean", Type.boolean)
                matcher.addHint("boolean", Type.boolean)
                continue
            }

            if (type.name == Type.string.name) {
                matcher.addPrimitive("string", Type.string)
                matcher.addHint("string", Type.string)
                continue
            }

            if (type.name == Type.atom.name) {
                matcher.addPrimitive("string", Type.atom)
                matcher.addHint("string", Type.atom)
                continue
            }

            if (type.name == Type.number.name) {
                matcher.addPrimitive("number", Type.number)
                matcher.addHint("number", Type.number)
                continue
            }

            if (Type.isArray(type)) {
                matcher.addArrayType(type)
                continue
            }

            if (Type.isMap(type)) {
                matcher.addMapType(type)
                continue
            }

            if (Type.isPassthrough(type)) {
                matcher.addFallbackType(type)
                continue
            }

            if (Type.isEnum(type)) {
                for (const entry of type.entries) {
                    matcher.addConstant(entry, type)
                }
                continue
            }

            if (Type.isObject(type)) {
                objectTypes.push(type)
                continue
            }

            throw new TypeError(`Type ${type.name} is not suitable for a UnionType`)
        }

        if (objectTypes.length > 0) {
            const discriminator = objectTypes[0].propList.find(([name, type]) => Type.isEnum(type) && type.entries.length == 1)?.[0]
            if (discriminator == null) {
                throw new UnionDiscriminationError(`Unable to find a discriminator property for object types`)
            }

            matcher.discriminator = discriminator
            matcher.objectTypes = new Map()

            for (const objectType of objectTypes) {
                const discriminatorType = objectType.props[discriminator]

                if (discriminatorType == null) {
                    throw new UnionDiscriminationError(`Type "${objectType.name}" lacks the discriminator property "${discriminator}"`)
                }

                if (!Type.isEnum(discriminatorType) || discriminatorType.entries.length != 1) {
                    throw new UnionDiscriminationError(`Type "${objectType.name}" has invalid discriminator property "${discriminator}"`)
                }

                const constant = discriminatorType.entries[0]
                matcher.addObjectType(constant, objectType)
            }
        }

        this._matcher = matcher
        return matcher
    }

    public addType(type: Type<T>) {
        this._types.push(type)
        this._matcher = null
    }

    public getDefinition(indent: string): string {
        return indent + this._types.map(v => v.name).join(" | ")
    }

    public default(): T {
        return this._types[0].default()
    }

    public verify(value: unknown): T {
        return this._prepareMatchers().matchValue(value).verify(value)
    }

    protected _serialize(source: T, serializer: Serializer): unknown {
        return this._prepareMatchers().matchValue(source)["_serialize"](source, serializer)
    }

    protected _deserialize(handle: any, deserializer: Deserializer): T {
        const hint = deserializer.getTypeHint(handle)
        return this._prepareMatchers().matchHandle(handle, hint, deserializer)["_deserialize"](handle, deserializer)
    }

    constructor(
        ...types: Type<T>[]
    ) {
        super()
        this._types = types
    }

    public static create<const T extends readonly Type[]>(...types: T) {
        return new UnionType<Type.Extract<T[number]>>(types as any)
    }
}
