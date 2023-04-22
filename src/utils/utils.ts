import {
    Liquidity,
    Market,
    LIQUIDITY_PROGRAM_ID_V4,
    SERUM_PROGRAM_ID_V3,
    LiquidityAssociatedPoolKeysV4,
    LiquidityPoolKeys,
    LiquidityPoolInfo
} from "@raydium-io/raydium-sdk";
import { Connection, PublicKey, Logs, Context } from "@solana/web3.js";
import { assert } from "console";
import { TG_GROUP, TG_URL } from "../constants";
import { Mongo } from "../database/Mongo";
import axios from "axios";

export async function fetchPoolKeys(
    connection: Connection,
    poolId: PublicKey,
    version: number = 4,
    marketVersion: number = 3,
    serumVersion: number = 3,
): Promise<LiquidityPoolKeys> {
    // Constants - IDs
    const programId: PublicKey = LIQUIDITY_PROGRAM_ID_V4;
    const serumProgramId: PublicKey = SERUM_PROGRAM_ID_V3;

    const account = await connection.getAccountInfo(poolId);
    const { state: LiquidityStateLayout } = Liquidity.getLayouts(version);
    //@ts-ignore
    const fields = LiquidityStateLayout.decode(account.data);

    const {
        status,
        baseMint,
        quoteMint,
        lpMint,
        openOrders,
        targetOrders,
        baseVault,
        quoteVault,
        marketId
    } = fields;

    let withdrawQueue = Liquidity.isV4(fields) ? fields.withdrawQueue : PublicKey.default;
    let lpVault = Liquidity.isV4(fields) ? fields.lpVault : PublicKey.default;

    const marketInfo = await connection.getAccountInfo(marketId);
    const { state: MARKET_STATE_LAYOUT } = Market.getLayouts(marketVersion);
    //@ts-ignore
    const market = MARKET_STATE_LAYOUT.decode(marketInfo.data);

    const {
        baseVault: marketBaseVault,
        quoteVault: marketQuoteVault,
        bids: marketBids,
        asks: marketAsks,
        eventQueue: marketEventQueue,
    } = market;

    const associatedPoolKeys: LiquidityAssociatedPoolKeysV4
        = await Liquidity.getAssociatedPoolKeys({
            version,
            baseMint,
            quoteMint,
            marketId
        });

    const poolKeys = {
        id: poolId,
        baseMint,
        quoteMint,
        lpMint,
        version,
        programId,
        authority: associatedPoolKeys.authority,
        openOrders,
        targetOrders,
        baseVault,
        quoteVault,
        withdrawQueue,
        lpVault,
        marketVersion: serumVersion,
        marketProgramId: serumProgramId,
        marketId,
        marketAuthority: associatedPoolKeys.marketAuthority,
    };

    return {
        ...poolKeys,
        ...{
            marketBaseVault,
            marketQuoteVault,
            marketBids,
            marketAsks,
            marketEventQueue,
        },
    };
}

export async function fetchPoolInfo(
    connection: Connection,
    poolKeys: LiquidityPoolKeys
): Promise<LiquidityPoolInfo> {
    return await Liquidity.fetchInfo({ connection, poolKeys });
}

export async function watchLiquidityStateUpdate(
    connection: Connection,
    poolKeys: LiquidityPoolKeys,
    mongo: Mongo,
    [reserveBase, reserveQuote]: [string, string]
): Promise<void> {
    const poolAddress: string = poolKeys.id.toString();
    const poolPublicKey: PublicKey = new PublicKey(poolAddress);

    let [rb, rq]: [string, string] = [reserveBase, reserveQuote];
    connection.onLogs(poolPublicKey, async (logs: Logs, ctx: Context) => {
        if (!logs.err) {
            let [updatedRb, updatedRq]: [string, string] 
                = parseReserveBaseQuoteString(logs.logs, [rb, rq]);

            if (updatedRb !== rb || updatedRq !== rq) {
                [rb, rq] = [updatedRb, updatedRq];
                await mongo.updateLiquidityState([rb, rq], poolAddress);
            }
        }
    });

    setInterval(async () => {
        await mongo.updateLiquidityState([rb, rq], poolAddress); 
    }, 5000);
    
    setInterval(async () => {
        const poolInfo: LiquidityPoolInfo = await fetchPoolInfo(connection, poolKeys);
        await mongo.updateLiquidityState([rb, rq], poolAddress, poolInfo); 
    }, 300000);

}

function parseReserveBaseQuoteString(
    logs: string[],
    [rb, rq]: [string, string]
): [string, string] {

    const logLength: number = logs.length;
    for (let idx = logLength - 1; idx >= 0; idx--) {
        if (logs[idx].includes("rb, rq")) {
            const reserveBaseQuote: string[] = logs[idx].split(" ").slice(-2);

            assert(reserveBaseQuote.length === 2);

            return [
                (reserveBaseQuote[0].slice(0, -1) as unknown) as string,
                (reserveBaseQuote[1] as unknown) as string
            ];
        }
    }
    return [rb, rq];
}


export async function telegramAlerts (message: string): Promise<void> {
    await axios.post<any>(
        TG_URL,
        { chat_id: TG_GROUP, text: message },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
    );
}