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
    Liquidity,
    LiquidityPoolInfo,
    LiquidityPoolKeys,
    Token,
    TokenAmount,
    Percent,
    LiquidityComputeAmountOutParams,
    CurrencyAmount,
    Price,
    Fraction
} from "@raydium-io/raydium-sdk";
import BN from "bn.js";

enum Rounding {
  ROUND_DOWN,
  ROUND_HALF_UP,
  ROUND_UP,
}

const ZERO = new BN(0);
const ONE = new BN(1);
const TWO = new BN(2);
const THREE = new BN(3);
const FIVE = new BN(5);
const TEN = new BN(10);
const _100 = new BN(100);
const _1000 = new BN(1000);
const _10000 = new BN(10000);
const LIQUIDITY_FEES_NUMERATOR = new BN(25);
const LIQUIDITY_FEES_DENOMINATOR = new BN(10000);
import { Mongo } from "./database/Mongo";

async function computeAmountOut(
    poolKeys: LiquidityPoolKeys,
    poolInfo: LiquidityPoolInfo,
    amount: number
): Promise<number> {

    const tokenIn: Token = new Token(poolKeys.quoteMint, poolInfo.quoteDecimals);
    const amountIn: TokenAmount = new TokenAmount(tokenIn, amount, false);
    const currencyOut: Token = new Token(poolKeys.baseMint, poolInfo.baseDecimals);
    const slippage: Percent = new Percent(1, 100); // 1%

    // Compute amount out given the pair in a certain pool
    const {
        amountOut,
        minAmountOut,
        currentPrice,
        executionPrice,
        priceImpact,
        fee,
    } = _computeAmountOut({ poolKeys, poolInfo, amountIn, currencyOut, slippage });
    
    return Number(minAmountOut.toFixed());
}

async function computeAmountIn(
    poolKeys: LiquidityPoolKeys,
    poolInfo: LiquidityPoolInfo,
    amount: number
): Promise<number> {

    const tokenOut: Token = new Token(poolKeys.baseMint, poolInfo.baseDecimals);
    const amountOut: TokenAmount = new TokenAmount(tokenOut, amount, false);
    const currencyIn: Token = new Token(poolKeys.quoteMint, poolInfo.quoteDecimals);
    const slippage: Percent = new Percent(1, 100); // 1%

    // Compute amount out given the pair in a certain pool
    const {
        amountIn,
        maxAmountIn,
        currentPrice,
        executionPrice,
        priceImpact
    } = Liquidity.computeAmountIn({ poolKeys, poolInfo, amountOut, currencyIn, slippage });
    
    return Number(maxAmountIn.toFixed());
}

async function getNotionals(): Promise<number[]> {

    const fibonnaci = (
        levels: number,
        firstEntry: number,
        secondEntry: number
    ): number[] => {
        let fib: number[] = new Array(levels);
        fib[0] = firstEntry;
        fib[1] = secondEntry;

        for (let idx = 2; idx < levels; idx++) {
            fib[idx] = fib[idx - 1] + fib[idx - 2];
        }
        return fib;
    }

    // const params: GoogleSheetStrat = await parseSheet(await readSheet("mm"));
    const params = {
        base: 'BTC',
        volume_coefficient: 1000000,
        fib_levels: 4,
        fib_first: 1,
        fib_second: 2
    }
    const mongo: Mongo = new Mongo();
    const baseSize: number =
        (await mongo.getLatestVolume(params.base)) / params.volume_coefficient;

    let fibs: number[] = fibonnaci(params.fib_levels, params.fib_first, params.fib_second);
    let notionals: number[] = fibs.map((price) => baseSize * price);
    // notionals.push(notionals.reduce((accumulator, current) => accumulator + current, 0));

    return notionals;
}

const _computeAmountOut = ({
    poolKeys,
    poolInfo,
    amountIn,
    currencyOut,
    slippage,
  }: LiquidityComputeAmountOutParams):
    | {
        amountOut: CurrencyAmount;
        minAmountOut: CurrencyAmount;
        currentPrice: Price;
        executionPrice: Price | null;
        priceImpact: Percent;
        fee: CurrencyAmount;
      }
    | {
        amountOut: TokenAmount;
        minAmountOut: TokenAmount;
        currentPrice: Price;
        executionPrice: Price | null;
        priceImpact: Percent;
        fee: CurrencyAmount;
      } => {
    const tokenIn = amountIn instanceof TokenAmount ? amountIn.token : Token.WSOL;
    const tokenOut = currencyOut instanceof Token ? currencyOut : Token.WSOL;
    

    const { baseReserve, quoteReserve } = poolInfo;
    
    const currencyIn = amountIn instanceof TokenAmount ? amountIn.token : amountIn.currency;
    const reserves = [baseReserve, quoteReserve];

    // input is fixed
    // const input = this._getAmountSide(amountIn, poolKeys);
    // if (input === "quote") {
    reserves.reverse();
    // }
    // logger.debug("input side:", input);

    const [reserveIn, reserveOut] = reserves;

    const amountInRaw = amountIn.raw;
    console.log(amountInRaw.toNumber());
    let amountOutRaw = ZERO;
    let feeRaw = ZERO;

    if (!amountInRaw.isZero()) {
      if (poolKeys.version === 4) {
        feeRaw = amountInRaw.mul(LIQUIDITY_FEES_NUMERATOR).div(LIQUIDITY_FEES_DENOMINATOR);
        const amountInWithFee = amountInRaw.sub(feeRaw);

        const denominator = reserveIn.add(amountInWithFee);
        amountOutRaw = reserveOut.mul(amountInWithFee).div(denominator);
      } 
    }

    const _slippage = new Percent(ONE).add(slippage);
    const minAmountOutRaw = _slippage.invert().mul(amountOutRaw).quotient;

    const amountOut =
      currencyOut instanceof Token
        ? new TokenAmount(currencyOut, amountOutRaw)
        : new CurrencyAmount(currencyOut, amountOutRaw);
    const minAmountOut =
      currencyOut instanceof Token
        ? new TokenAmount(currencyOut, minAmountOutRaw)
        : new CurrencyAmount(currencyOut, minAmountOutRaw);

    let executionPrice = new Price(currencyIn, amountInRaw.sub(feeRaw), currencyOut, amountOutRaw);
    if (!amountInRaw.isZero() && !amountOutRaw.isZero()) {
      executionPrice = new Price(currencyIn, amountInRaw.sub(feeRaw), currencyOut, amountOutRaw);
    }

    // const priceImpact = this._computePriceImpact(currentPrice, amountInRaw, amountOutRaw);
    // TODO
    let currentPrice = new Price(currencyIn, reserveIn, currencyOut, reserveOut);
    const priceImpact = new Percent(new BN(1), new BN(2));
    // new Percent(
    //   parseInt(String(Math.abs(parseFloat(executionPrice.toFixed()) - parseFloat(currentPrice.toFixed())) * 1e9)),
    //   parseInt(String(parseFloat(currentPrice.toFixed()) * 1e9)),
    // );
    console.log("priceImpact:", `${priceImpact.toSignificant()}%`);

    const fee =
      currencyIn instanceof Token ? new TokenAmount(currencyIn, feeRaw) : new CurrencyAmount(currencyIn, feeRaw);

    return {
      amountOut,
      minAmountOut,
      currentPrice,
      executionPrice,
      priceImpact,
      fee,
    };
  };

const main = async () => {
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
    
    const params = {
        base: 'BTC',
        volume_coefficient: 1000000,
        fib_levels: 4,
        fib_first: 1,
        fib_second: 2
    }

    const notionals: number[] = await getNotionals();
    const fx: number = await mongo.getLatestFX(params.base);
    const poolAddress: string = "6kbC5epG18DF2DwPEW34tBy5pGFS7pEGALR3v5MGxgc5";
    const poolKeys: LiquidityPoolKeys
            = await fetchPoolKeys(connection, new PublicKey(poolAddress));
    let poolInfo: LiquidityPoolInfo = await fetchPoolInfo(connection, poolKeys);

    const bids: number[] = await Promise.all(notionals.map(async (price: number) => {
        return await computeAmountOut(poolKeys, poolInfo, price);
    }));
    const asks: number[] = await Promise.all(notionals.map(async (price: number) => {
        return await computeAmountIn(poolKeys, poolInfo, price/fx);
    }));

    console.log(notionals);
    console.log(bids);
    console.log(asks);

}

main().catch(err => {
    console.error(err);
});
