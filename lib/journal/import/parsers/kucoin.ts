import { fillsParser } from "../pipelines";

/**
 * KuCoin → Orders → Trade History → Export (CSV). Spot columns: tradeCreatedAt, symbol, side, price, size, funds,
 * fee, feeCurrency, orderId, tradeId. Futures exports add "Realized PNL".
 */
export const kucoinParser = fillsParser({
  id: "kucoin",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  required: [["tradeCreatedAt", "Filled Time", "Time"], ["symbol"], ["side"], ["price", "Filled Price"], ["size", "Filled Amount"]],
  signature: [["funds"], ["feeCurrency"], ["tradeId"]],
  columns: {
    time: ["tradeCreatedAt", "Filled Time", "Time"],
    instrument: ["symbol"],
    side: ["side"],
    qty: ["size", "Filled Amount"],
    price: ["price", "Filled Price"],
    fee: ["fee"],
    realized: ["Realized PNL", "realizedPnl"],
    id: ["tradeId", "orderId"],
  },
  computeProfit: true,
});
