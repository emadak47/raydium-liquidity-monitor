#!/usr/bin/env ts-node
import { Connection, PublicKey } from "@solana/web3.js";
import {
    SOLANA_RPC_ENDPOINT,
} from "./constants";
import {
    fetchPoolKeys,
    fetchPoolInfo,
    watchLiquidityStateUpdate,
    telegramAlerts
} from "./utils/utils";
import {
    LiquidityPoolInfo,
    LiquidityPoolKeys,
} from "@raydium-io/raydium-sdk";
import { Mongo } from "./database/Mongo";

const main = async () => {

    await telegramAlerts("Raydium Script Starting........");

    const connection: Connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

    const mongo: Mongo = new Mongo();
    const dexPools = await mongo.getDexPools();
    const liquidityStates = await mongo.getLiquidityStates();
    
    let poolAddresses = new Array<string>();
    let poolToBaseQuote = new Map<string, string[]>();
    dexPools.map((pool) => {
        poolAddresses.push(pool.address);
        poolToBaseQuote.set(pool.address, [pool.base, pool.quote]);
    });

    poolAddresses.map(async (poolAddress) => {
        let state = liquidityStates.find(state => state.address == poolAddress);
        const poolKeys: LiquidityPoolKeys
            = await fetchPoolKeys(connection, new PublicKey(poolAddress));

        if (!state) {
            console.log(`Pool not found for: ${poolToBaseQuote.get(poolAddress)}`);

            let poolInfo: LiquidityPoolInfo = await fetchPoolInfo(connection, poolKeys);
            let updatedLiquidityState = await mongo.updateLiquidityState(
                [poolInfo.baseReserve.toString(), poolInfo.quoteReserve.toString()],
                poolAddress,
                poolInfo
            );

            state = { ...state, ...updatedLiquidityState };
            await telegramAlerts(`Liquidity State Updated for: ${poolToBaseQuote.get(poolAddress)}`);
        }

        let [reserveBase, reserveQuote]: [string, string] = [state.baseReserve, state.quoteReserve];
        await watchLiquidityStateUpdate(
            connection,
            poolKeys,
            mongo,
            [reserveBase, reserveQuote]
        );
    });
}

main().catch(err => {
    console.error(err);
});
