export const fiscalText = {
  ru: {
    title: "Государственные финансы США", intro: "Федеральный долг, бюджет и процентные расходы по данным Казначейства США.",
    groups: { debt: "Федеральный долг", budget: "Федеральный бюджет", interest: "Обслуживание долга" },
    metrics: { debt: ["Общий долг", "Долг в руках публики", "Внутригосударственный долг"],
      budget: ["Доходы", "Расходы", "Баланс бюджета"], interest: ["Валовые процентные расходы"] },
    observed: "Дата наблюдения", monthEnding: "Месяц по", checked: "Получено AYRA", change: "Изменение общего долга",
    fytd: "С начала финансового года · FY", stale: "Данные давно не обновлялись",
    monthlySample: "Последнее доступное наблюдение каждого месяца.", partial: "Доступны только недавние наблюдения. Полная история временно недоступна.",
    notes: {
      debt: "Остаток долга. Исходная единица — USD. Изменение рассчитано между крайними показанными датами.",
      budget: "Кассовые потоки за месяц. Отрицательный баланс — дефицит, положительный — профицит. Исходная единица API — USD.",
      interest: "Процентные расходы Treasury, включая государственные счета. Исходная единица — USD.",
    },
    context: "Как читать государственные финансы",
    education: [
      "Общий федеральный долг включает долг у внешних держателей и обязательства перед федеральными счетами. Долг может расти из-за дефицита и других потребностей в финансировании.",
      "Дефицит возникает, когда расходы превышают доходы. Финансовый год США начинается в октябре. Суммы с его начала рассчитывает Казначейство.",
      "Высокие ставки могут постепенно увеличивать стоимость обслуживания по мере рефинансирования долга. Спрос на облигации, ожидания по ставке ФРС и мировая склонность к риску тоже влияют на доходности и USD.",
    ],
  },
  en: {
    title: "U.S. public finances", intro: "Federal debt, budget and interest expense from the U.S. Treasury.",
    groups: { debt: "Federal debt", budget: "Federal budget", interest: "Debt service" },
    metrics: { debt: ["Total debt", "Debt held by the public", "Intragovernmental holdings"],
      budget: ["Receipts", "Outlays", "Budget balance"], interest: ["Gross interest expense"] },
    observed: "Observation date", monthEnding: "Month ending", checked: "Retrieved by AYRA", change: "Change in total debt",
    fytd: "Fiscal year to date · FY", stale: "Data may be out of date",
    monthlySample: "Last available observation in each month.", partial: "Only recent observations are available. Full history is temporarily unavailable.",
    notes: {
      debt: "Outstanding balance. Source unit is USD. Change uses the first and last available dates in the selected range.",
      budget: "Monthly cash flows. A negative balance is a deficit, a positive balance is a surplus. API source unit is USD.",
      interest: "Treasury interest expense includes government accounts. Source unit is USD.",
    },
    context: "How to read public finances",
    education: [
      "Total federal debt includes debt held by the public and obligations to federal accounts. Deficits and other financing needs can increase outstanding debt.",
      "A deficit occurs when outlays exceed receipts. The U.S. fiscal year starts in October. The Treasury reports cumulative fiscal-year amounts.",
      "Higher rates can raise interest costs gradually as debt is refinanced. Bond demand, Federal Reserve expectations and global risk appetite also affect yields and the dollar.",
    ],
  },
};
