/* eslint-disable no-console */
import { IDProvider } from "../dependencyInjection/commonServices/IDProvider"
import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { DIContext } from "../dependencyInjection/DIContext"
import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"
import { ActionType } from "../structSync/ActionType"
import { EventType } from "../structSync/EventType"
import { StructSyncClient } from "../structSync/StructSyncClient"
import { StructSyncContract } from "../structSync/StructSyncContract"
import { StructSyncServer } from "../structSync/StructSyncServer"
import { StructSyncSession } from "../structSync/StructSyncSession"


void (async () => {
    class Test extends Struct.define("Test", {
        name: Type.string,
        height: Type.number,
        nicknames: Type.string.as(Type.array),
        homes: Type.object({
            address: Type.string,
            doorSize: Type.number.as(Type.nullable)
        }).as(Type.record)
    }) { }

    console.log(Test.definition)
    console.log(Test.default())
    console.log(Test.default().serialize())

    console.log(Test.deserialize({
        name: "",
        height: 0,
        nicknames: [],
        homes: {}
    }))

    class Deriv extends Struct.define("Deriv", {
        test: Test.ref()
    }) { }

    console.log(Deriv.deserialize(Deriv.default().serialize()))

    type _1 = Struct.BaseType<typeof Test>

    const context = new DIContext()

    context.provide(IDProvider, () => new IDProvider.Incremental())
    context.provide(MessageBridge, () => new MessageBridge.Dummy())
    context.provide(StructSyncClient, "default")
    context.provide(StructSyncServer, "default")

    context.instantiate(() => new StructSyncSession(context.inject(MessageBridge)))

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
    }, {
        onTrackPromoted: EventType.define("onTrackPromoted", Track.ref())
    })

    class PlaylistProxy extends PlaylistContract.defineProxy() { }
    class PlaylistController extends PlaylistContract.defineController() {
        public impl = super.impl({
            removeTrack: async ({ index }) => {
                console.log("Removing track", index)
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

    playlistProxy.onMutate.add(null, msg => console.log(msg))

    console.log(playlistProxy.tracks)

    await playlistProxy.removeTrack({ index: 1 })

    console.log(playlistProxy.tracks)

    console.log("Name:", [playlistProxy.name])

    await playlistController.mutate(v => v.name = "new_name")

    console.log("Name:", [playlistProxy.name])

    console.log("Tracks:", playlistProxy.tracks)
    await playlistController.mutate(v => v.tracks[0].name = "new_name")
    console.log("Tracks:", playlistProxy.tracks)

    playlistProxy.onTrackPromoted.add(null, (track) => console.log(track), true)
    playlistController.onTrackPromoted.emit(playlistController.tracks[0])
})().catch(err => console.error(err))