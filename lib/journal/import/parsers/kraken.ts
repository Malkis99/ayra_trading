import { fillsParser } from "../pipelines";

/**
 * Kraken → History → Export → Trades (trades.csv). Columns: txid, ordertxid, pair, time, type (buy/sell),
 * ordertype, price, cost, fee, vol, margin, misc, ledgers.
 */
export const krakenParser = fillsParser({
  id: "kraken",
  group: "crypto",
  kinds: ["csv"],
  required: [["txid"], ["pair"], ["time"], ["type"], ["price"], ["vol"]],
  signature: [["ordertxid"], ["ordertype"], ["cost"], ["ledgers"]],
  columns: {
    time: ["time"],
    instrument: ["pair"],
    side: ["type"],
    qty: ["vol"],
    price: ["price"],
    fee: ["fee"],
    id: ["txid"],
  },
  computeProfit: true,
});
