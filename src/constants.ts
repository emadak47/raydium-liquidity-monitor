import { Cluster } from "@solana/web3.js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

export const __PROD__: boolean = process.env.NODE_ENV === "production";

// Endpoints & Connection
export const ENV: Cluster = (process.env.CLUSTER as Cluster) || "mainnet-beta";
export const SOLANA_RPC_ENDPOINT =
    ENV == "devnet"
        ? "https://api.devnet.solana.com"
        : "https://delicate-small-smoke.solana-mainnet.quiknode.pro/7f814e782a1f3141a09bbb5385e3624fffbda6b8/";

// Database
export const MONGODB_URI: string = process.env.MONGODB_URI;

// TG 
export const TG_GROUP = process.env.TG_GROUP;
export const TG_TOKEN = process.env.TG_TOKEN;
export const TG_URL = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;