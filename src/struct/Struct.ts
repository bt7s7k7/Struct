import { Type } from "./Type"

export namespace Struct {
    export class StructBase {
        serialize<T extends { constructor: any }>(this: T): any {
            return this.constructor.serialize(this)
        }
    }

    interface StructStatics<T extends Type.ObjectType<any>> {
        new(source: Type.ResolveObjectType<T["props"]>): StructBase & Type.ResolveObjectType<T["props"]>
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
                Object.assign(this, source)
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
}