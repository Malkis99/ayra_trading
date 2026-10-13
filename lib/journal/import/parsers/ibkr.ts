import type { ImportParser } from "../types";
import { fillsParser } from "../pipelines";

/**
 * Interactive Brokers:
 * - Flex Query "Trades" (CSV): Symbol, DateTime ("20240115;103000"), Buy/Sell, Quantity (signed), TradePrice,
 *   IBCommission, FifoPnlRealized, Open/CloseIndicator, TradeID.
 * - Activity Statement (CSV with sections): Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,
 *   Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Code. Only "Order"/"Trade" rows are fills.
 */
const flex = fillsParser({
  id: "ibkr",
  group: "stocks",
  kinds: ["csv"],
  required: [["Symbol"], ["TradePrice"], ["Quantity"], ["DateTime", "TradeDate"]],
  signature: [["IBCommission"], ["FifoPnlRealized"], ["Open/CloseIndicator"], ["TradeID"]],
  columns: {
    time: ["DateTime", "TradeDate"],
    instrument: ["Symbol"],
    side: ["Buy/Sell"],
    qty: ["Quantity"],
    price: ["TradePrice"],
    fee: ["IBCommission"],
    realized: ["FifoPnlRealized"],
    effect: ["Open/CloseIndicator"],
    id: ["TradeID"],
  },
  signedQty: true,
  computeProfit: true,
});

const activity = fillsParser({
  id: "ibkr",
  group: "stocks",
  kinds: ["csv"],
  required: [["Symbol"], ["Date/Time"], ["Quantity"], ["T. Price"]],
  signature: [["DataDiscriminator"], ["Comm/Fee"], ["Realized P/L"], ["Proceeds"]],
  columns: {
    time: ["Date/Time"],
    instrument: ["Symbol"],
    side: ["Buy/Sell"],
    qty: ["Quantity"],
    price: ["T. Price"],
    fee: ["Comm/Fee", "Comm in USD"],
    realized: ["Realized P/L"],
  },
  signedQty: true,
  computeProfit: true,
  skipRow: (row) => {
    // Section rows: first cell = section name, second = Header/Data/SubTotal/Total
    if (row[0] && row[0] !== "Trades") return true;
    if (row[1] && row[1] !== "Data") return true;
    if (row[2] && !/^(order|trade|executionmarket)$/i.test(row[2])) return true;
    return false;
  },
});

export const ibkrParser: ImportParser = {
  id: "ibkr",
  group: "stocks",
  kinds: ["csv"],
  verification: "documented",
  detect: (t) => Math.max(flex.detect(t), activity.detect(t)),
  parse: (t, o) => (flex.detect(t) >= activity.detect(t) ? flex.parse(t, o) : activity.parse(t, o)),
};
