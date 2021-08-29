import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"
import { StructSyncMessages } from "./StructSyncMessages"

export namespace MutationUtil {
    export function runMutationThunk<T>(targetName: string, target: T, baseType: Type<any>, thunk: (proxy: T) => void) {
        const mutations: StructSyncMessages.AnyMutateMessage[] = []

        const makeProxy = (object: any, type: Type<any>, path: string[]): any => {
            if (!Type.isArray(type) && !Type.isObject(type) && !Type.isRecord(type)) throw new Error("Cannot mutate a type that is not an object, array or record")

            return new Proxy(object, {
                set(target, key, value, receiver) {
                    if (typeof key == "symbol") throw new Error("Cannon mutate a symbol indexed property")

                    if (!Reflect.set(target, key, value, receiver)) return false

                    const serializedValue = !Type.isObject(type) ? type.type.serialize(value) : type.props[key].serialize(value)

                    mutations.push({
                        type: "mut_assign",
                        target: targetName,
                        value: serializedValue,
                        path, key
                    })

                    return true
                },
                deleteProperty(target, key) {
                    if (typeof key == "symbol") throw new Error("Cannon mutate a symbol indexed property")

                    if (!Reflect.deleteProperty(target, key)) return false

                    mutations.push({
                        type: "mut_delete",
                        target: targetName,
                        path, key
                    })

                    return true
                },
                get(target, key, receiver) {
                    if (typeof key == "symbol") throw new Error("Cannon mutate a symbol indexed property")

                    if (Type.isArray(type)) {
                        if (key == "length") return target.length

                        const func = ({
                            splice(start: number, deleteCount: number, ...items: any[]) {
                                mutations.push({
                                    type: "mut_splice",
                                    deleteCount, path,
                                    target: targetName,
                                    index: start,
                                    items: type.serialize(items)
                                })

                                target.splice(start, deleteCount, ...items)
                            },
                            push(...items) {
                                this.splice(this.length, 0, ...items)
                            }
                        } as Partial<any[]>)[key as any]

                        if (func) return func

                        if (key in []) throw new Error(`Unsupported array operation ${JSON.stringify(key)}`)
                    }

                    return makeProxy(Reflect.get(target, key, receiver), Type.isObject(type) ? type.props[key] : type.type, [...path, key])
                }
            })
        }

        thunk(makeProxy(target, baseType, []))

        return mutations
    }

    export function applyMutation(target: Struct.StructBase, mutation: StructSyncMessages.AnyMutateMessage) {
        let receiver: any = target
        let type = Struct.getBaseType(target) as Type.ObjectType | Type.ArrayType | Type.RecordType

        mutation.path.forEach((prop, i) => {
            receiver = receiver[prop]
            const newType = (Type.isObject(type) ? type.props[prop] : type.type)
            if (!newType || (!Type.isObject(newType) && !Type.isArray(newType) && !Type.isRecord(newType))) throw new Error(`Invalid mutation target at .${mutation.path.slice(0, i).join(".")}`)
            type = newType
        })

        if (mutation.type == "mut_assign") {
            const valueType = Type.isObject(type) ? type.props[mutation.key] : type.type
            receiver[mutation.key] = valueType.deserialize(mutation.value)
        } else if (mutation.type == "mut_splice") {
            if (!Type.isArray(type)) throw new Error("Unexpected splice on not array type")
            receiver.splice(mutation.index, mutation.deleteCount, ...type.deserialize(mutation.items))
        } else if (mutation.type == "mut_delete") {
            if (Type.isArray(type)) throw new Error("Cannot delete property from array type")
            delete receiver[mutation.key]
        } else throw new Error(`Unknown mutation type ${JSON.stringify((mutation as any).type)}`)
    }
}