import { Type } from "./Type"

export namespace Struct {
    export class StructBase { }

    interface StructStatics<T extends Type.ObjectType<any>> {
        new(source: Type.ResolveObjectType<T["props"]>): StructBase & Type.ResolveObjectType<T["props"]>
        default<T extends { new(...args: any): any }>(this: T): InstanceType<T>
    }

    export type TypedStruct<T extends Type.ObjectType<any>> = Omit<T, "default"> & StructStatics<T>

    export function define<T extends Record<string, Type<any>>>(name: string, props: T): TypedStruct<Type.ObjectType<T>> {
        const objectType = Type.namedType(name, props)

        class StructInstance extends StructBase {
            constructor(source: Type.ResolveObjectType<T>) {
                super()
                Object.assign(this, source)
            }
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

            Object.defineProperty(StructInstance, key, {
                get() {
                    return (objectType as any)[key]
                }
            })
        }

        return StructInstance as TypedStruct<Type.ObjectType<T>>

    }
}