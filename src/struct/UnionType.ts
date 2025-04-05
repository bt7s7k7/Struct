import { DeserializationError, Deserializer, Serializer, Type } from "./Type"

function _testEnumEntry(handle: any, deserializer: Deserializer, entry: any, hint: ReturnType<Deserializer["getTypeHint"]>): boolean {
    if (
        (typeof entry == "string" && hint == "string") ||
        (typeof entry == "number" && hint == "number") ||
        (typeof entry == "boolean" && hint == "boolean")
    ) {
        if (deserializer.parsePrimitive(handle) == entry) {
            return true
        }
    }

    return false
}

/**
 * Union type can be used for serialization of a value that can have multiple types. The matching is optimistic and deterministic using the specified type order -
 * the first type that matches will be used for deserialization. Not all types are supported, matching supports primitive types, nullable and optional types,
 * array and map types (only one array and map type can be used, their element types are not used to discriminate between them) and object types (objects must
 * have at least one enum property with only one possible value to allow for discrimination).
 * 
 * The {@link UnionType.types} property is mutable, types can be added after the type is constructed.
 */
export class UnionType<T> extends Type<T> {
    public get name() { return this.getDefinition("") }

    public getDefinition(indent: string): string {
        return indent + this.types.map(v => v.name).join(" | ")
    }

    public default(): T {
        return this.types[0].default()
    }

    protected _getMatchingType(value: unknown): Type<T> {
        for (let type of this.types) {
            if (Type.isNullable(type)) {
                if (value == null) return type
                type = type.base
            }

            if (Type.isOptional(type)) {
                if (value == null) return type
                type = type.base
            }

            if (type.name == Type.boolean.name) {
                if (typeof value == "boolean") return type
                continue
            }

            if (type.name == Type.string.name) {
                if (typeof value == "string") return type
                continue
            }

            if (type.name == Type.atom.name) {
                if (typeof value == "string") return type
                continue
            }

            if (type.name == Type.number.name) {
                if (typeof value == "number") return type
                continue
            }

            if (Type.isArray(type)) {
                if (value instanceof Array) return type
                continue
            }

            if (Type.isMap(type)) {
                if (value instanceof Map) return type
                continue
            }

            if (Type.isPassthrough(type)) return type

            if (Type.isEnum(type)) {
                for (const entry of type.entries) {
                    if (value == entry) return type
                }

                continue
            }

            if (Type.isObject(type) && typeof value == "object" && value != null && !(value instanceof Array)) {
                for (const [key, prop] of type.propList) {
                    if (!(key in value)) continue

                    if (Type.isEnum(prop) && prop.entries.length == 1) {
                        if (prop.entries[0] == (value as any)[key]) {
                            return type
                        }
                    }
                }

                continue
            }

            throw new TypeError(`Type ${type.name} is not suitable for a UnionType`)
        }

        throw new DeserializationError("No types in the union match the specified value")
    }

    public verify(value: unknown): T {
        return this._getMatchingType(value).verify(value)
    }

    protected _serialize(source: T, serializer: Serializer): unknown {
        return this._getMatchingType(source)["_serialize"](source, serializer)
    }

    protected _deserialize(handle: any, deserializer: Deserializer): T {
        const hint = deserializer.getTypeHint(handle)

        for (let type of this.types) {
            if (Type.isNullable(type)) {
                if (hint == "null") return null as T
                type = type.base
            }

            if (Type.isOptional(type)) {
                if (hint == "null") return null as T
                type = type.base
            }

            if (type.name == Type.boolean.name) {
                if (hint == "boolean") return type["_deserialize"](handle, deserializer)
                continue
            }

            if (type.name == Type.string.name) {
                if (hint == "string") return type["_deserialize"](handle, deserializer)
                continue
            }

            if (type.name == Type.atom.name) {
                if (hint == "string") return type["_deserialize"](handle, deserializer)
                continue
            }

            if (type.name == Type.number.name) {
                if (hint == "number") return type["_deserialize"](handle, deserializer)
                continue
            }

            if (Type.isArray(type)) {
                if (hint == "array") return type["_deserialize"](handle, deserializer)
                continue
            }

            if (Type.isMap(type)) {
                if (hint == "object") return type["_deserialize"](handle, deserializer)
                continue
            }

            if (Type.isPassthrough(type)) return type["_deserialize"](handle, deserializer)

            if (Type.isEnum(type)) {
                for (const entry of type.entries) {
                    if (_testEnumEntry(handle, deserializer, entry, hint)) {
                        return entry
                    }
                }
                continue
            }

            if (Type.isObject(type) && hint == "object") {
                for (const [key, prop] of type.propList) {
                    if (Type.isEnum(prop) && prop.entries.length == 1) {
                        const propertyHandle = deserializer.getObjectProperty(handle, key)
                        if (_testEnumEntry(propertyHandle, deserializer, prop.entries[0], deserializer.getTypeHint(propertyHandle))) {
                            return type["_deserialize"](handle, deserializer)
                        }
                    }
                }
                continue
            }

            throw new TypeError(`Type ${type.name} is not suitable for a UnionType`)
        }

        throw new DeserializationError("No types in the union match the specified value")
    }

    constructor(
        public readonly types: Type<T>[]
    ) { super() }
}
