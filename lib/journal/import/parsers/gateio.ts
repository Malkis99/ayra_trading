import { fillsParser } from "../pipelines";

/**
 * Gate.io → Orders → Trade history → Export (CSV). Columns: Time, Trade ID, Pair / Market, Side / Type, Price,
 * Amount, Total, Fee, Fee Currency. Futures exports use "Contract" and add "PnL".
 */
export const gateioParser = fillsParser({
  id: "gateio",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  required: [["Time"], ["Pair", "Market", "Contract"], ["Side", "Type"], ["Price"], ["Amount"], ["Fee Currency", "Fee"]],
  signature: [["Trade ID"], ["Total"], ["Fee Currency"]],
  columns: {
    time: ["Time"],
    instrument: ["Pair", "Market", "Contract"],
    side: ["Side", "Type"],
    qty: ["Amount"],
    price: ["Price"],
    fee: ["Fee"],
    realized: ["PnL", "Realized PnL"],
    id: ["Trade ID"],
  },
  computeProfit: true,
});
