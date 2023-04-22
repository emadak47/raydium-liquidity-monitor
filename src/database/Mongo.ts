import { Collection, Db, MongoClient, UpdateResult, WithId } from "mongodb";
import { MONGODB_URI } from "../constants";
import _ from "lodash";
import { LiquidityPoolInfo } from "@raydium-io/raydium-sdk";

interface Collections {
    fx?: Collection,
    trades?: Collection,
    volume?: Collection,
    dexCoins?: Collection,
    dexPools?: Collection,
    params?: Collection,
    liquidity?: Collection,
}

export const collections: Collections = {};

export class Mongo {
    private client: MongoClient;

    constructor(private _uri: string = MONGODB_URI) {
        this.client = new MongoClient(_uri);
    }

    private async connect(dbName: string, collectionName: string): Promise<void> {
        try {
            await this.client.connect();

            const database: Db = this.client.db(dbName);
            const collection: Collection = database.collection(collectionName);

            type CollectionsKey = keyof typeof collections;
            collections[_.camelCase(collectionName) as CollectionsKey] = collection;
        } catch (e) {
            throw e;
        }
    }

    public async updateLiquidityState(
        [baseReserve, quoteReserve]: [string, string],
        poolId: string,
        poolInfo?: LiquidityPoolInfo
    ): Promise<{ baseReserve: string, quoteReserve: string }> {
        await this.getLiquidityStates();

        const updatedReservesOnly = {
            baseReserve: baseReserve,
            quoteReserve: quoteReserve,
            ts: new Date(),
        };

        let updatedPoolInfo;
        if (poolInfo) {
            updatedPoolInfo = {
                ...poolInfo,
                status: poolInfo.status.toNumber(),
                baseReserve: poolInfo.baseReserve.toString(),
                quoteReserve: poolInfo.quoteReserve.toString(),
                startTime: poolInfo.startTime.toNumber(),
                lpSupply: poolInfo.lpSupply.toString()
            }
        }

        const updatedLiquidityState = poolInfo
            ? { ...updatedReservesOnly, ...updatedPoolInfo }
            : updatedReservesOnly;

        const result: UpdateResult = await collections?.liquidity?.updateOne(
            { address: poolId },
            { $set: updatedLiquidityState },
            { upsert: true }
        );
        return {
            baseReserve: updatedLiquidityState.baseReserve,
            quoteReserve: updatedLiquidityState.quoteReserve
        };
    }

    public async getDexPools(network: string = "solana") {
        await this.connect("market_settings", "dex_pools");
        return collections?.dexPools?.find({ network: network }).toArray();
    }

    public async getLiquidityStates() {
        await this.connect("market_data", "liquidity");
        return collections?.liquidity?.find({}).toArray();
    }

    public async getLatestFX(base: string): Promise<number> {
        await this.connect("market_data", "fx");
        return (await collections?.fx?.find({ base: base })
            .sort('ts', -1)
            .limit(1)
            .toArray()
        )[0]["price"];
    }

    public async getLatestVolume(base: string): Promise<number> {
        await this.connect("market_data", "volume");
        return (await collections?.volume?.find({ base: base })
            .sort('ts', -1)
            .limit(1)
            .toArray()
        )[0]["volume"];
    }
}