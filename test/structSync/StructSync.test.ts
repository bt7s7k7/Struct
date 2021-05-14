import { expect } from "chai"
import { IDProvider } from "../../src/dependencyInjection/commonServices/IDProvider"
import { MessageBridge } from "../../src/dependencyInjection/commonServices/MessageBridge"
import { DIContext } from "../../src/dependencyInjection/DIContext"
import { Struct } from "../../src/struct/Struct"
import { Type } from "../../src/struct/Type"
import { ActionType } from "../../src/structSync/ActionType"
import { StructSyncClient } from "../../src/structSync/StructSyncClient"
import { StructSyncContract } from "../../src/structSync/StructSyncContract"
import { StructSyncServer } from "../../src/structSync/StructSyncServer"
import { StructSyncSession } from "../../src/structSync/StructSyncSession"
import { makeAsyncLock } from "../testUtil/asyncLock"
import { describeMember } from "../testUtil/describeMember"
import { tracker } from "../testUtil/tracker"

describe("StructSync", () => {
    function makeContract() {
        class Track extends Struct.define("Track", {
            name: Type.string,
            artist: Type.string,
            icon: Type.string
        }) { }

        class Playlist extends Struct.define("Playlist", {
            name: Type.string,
            icon: Type.string,
            tracks: Track.ref().as(Type.array)
        }) { }

        const PlaylistContract = StructSyncContract.define(Playlist, {
            removeTrack: ActionType.define("removeTrack", Type.object({ index: Type.number }), Type.empty)
        })

        return { Track, Playlist, PlaylistContract }
    }

    async function makeParticipants() {
        const { PlaylistContract, Track } = makeContract()
        const context = makeContext()

        class PlaylistProxy extends PlaylistContract.defineProxy() { }
        class PlaylistController extends PlaylistContract.defineController() {
            public impl = super.impl({
                removeTrack: async ({ index }) => {
                    await this.mutate(v => v.tracks.splice(index, 1))
                }
            })
        }

        const playlistController = context.instantiate(() => new PlaylistController({
            icon: "icon_url", name: "playlist_name", tracks: [
                new Track({
                    name: "track_1",
                    artist: "artist_1",
                    icon: "icon_1"
                }),
                new Track({
                    name: "track_2",
                    artist: "artist_2",
                    icon: "icon_2"
                }),
                new Track({
                    name: "track_3",
                    artist: "artist_3",
                    icon: "icon_3"
                }),
            ]
        }).register())

        const playlistProxy = await PlaylistProxy.make(context)

        return { PlaylistContract, PlaylistProxy, PlaylistController, playlistController, playlistProxy }
    }

    function makeContext() {
        const context = new DIContext()

        context.provide(IDProvider, () => new IDProvider.Incremental())
        context.provide(MessageBridge, () => new MessageBridge.Dummy())
        context.provide(StructSyncClient, "default")
        context.provide(StructSyncServer, "default")

        context.instantiate(() => new StructSyncSession(context.inject(MessageBridge)))

        return context
    }

    describeMember(() => StructSyncContract, () => {
        it("Should be able to create a contract", () => {
            const { PlaylistContract, Playlist } = makeContract()

            expect(PlaylistContract.base).to.equal(Playlist)
        })

        it("Should be able to define participants", async () => {
            const { PlaylistController, playlistController, PlaylistProxy, playlistProxy } = await makeParticipants()

            expect(playlistController).to.be.instanceOf(PlaylistController)
            expect(playlistProxy).to.be.instanceOf(PlaylistProxy)
            expect(playlistProxy.serialize()).to.deep.equal(playlistController.serialize())
        })

        it("Should be able to run actions from proxy", async () => {
            const { playlistProxy, playlistController } = await makeParticipants()

            expect(playlistController.tracks).to.have.lengthOf(3)
            const oldTracks = [...playlistController.tracks]

            await playlistProxy.removeTrack({ index: 1 })
            await makeAsyncLock().resolve()

            expect(playlistController.tracks).to.have.lengthOf(2)
            expect(playlistController.tracks[0]).to.equal(oldTracks[0])
            expect(playlistController.tracks[1]).to.equal(oldTracks[2])

        })

        it("Should be able to send mutations from controller", async () => {
            const { playlistController, playlistProxy } = await makeParticipants()

            const expectMutation = async (thunk: () => Promise<void>) => {
                const mutationTracker = tracker("mutationTracker")
                playlistProxy.onMutate.add(null, () => mutationTracker.trigger(), true)
                await thunk()
                mutationTracker.check()
            }

            expect(playlistProxy.name).to.equal("playlist_name")
            await expectMutation(async () => {
                await playlistController.mutate(v => v.name = "new_name")
            })
            expect(playlistProxy.name).to.equal("new_name")

            expect(playlistProxy.tracks[0].name).to.equal("track_1")
            await expectMutation(async () => {
                await playlistController.mutate(v => v.tracks[0].name = "new_name")
            })
            expect(playlistProxy.tracks[0].name).to.equal("new_name")
        })
    })

    describe("context", () => {
        it("Should be able to provide StructSync services", () => {
            const context = makeContext()

            expect(context.inject(StructSyncClient)).to.be.instanceOf(StructSyncClient)
            expect(context.inject(StructSyncServer)).to.be.instanceOf(StructSyncServer)
        })
    })
})