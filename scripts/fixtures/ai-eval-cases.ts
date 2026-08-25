import type { EvidenceSignal, ResearchDocument, ResearchRisk } from "../../lib/ai-research-types.ts";

export type AiEvalCase = {
  id: string;
  company: string;
  thesis: string;
  evidence: string;
  markers: string[];
  expectedSignal: EvidenceSignal;
  expectedRisk: ResearchRisk;
  insertAt: number;
};

// Synthetic reports keep the benchmark redistributable and make every expected label auditable.
// Each case was assigned an evidence signal and risk label before running the model.
export const AI_EVAL_CASES: AiEvalCase[] = [
  { id: "support-01", company: "Northstar Cloud", thesis: "Recurring cloud revenue will grow while customer retention remains above 95%.", evidence: "Recurring cloud revenue grew 24%, and customer retention was 97% for the period. Management reported no material customer losses.", markers: ["customer retention was 97%"], expectedSignal: "supports", expectedRisk: "low", insertAt: 0 },
  { id: "support-02", company: "Harbor Medical", thesis: "New hospital contracts will expand revenue without reducing gross margin.", evidence: "The company signed twelve new hospital contracts, revenue grew 18%, and gross margin increased from 61% to 64%. No contract cancellations were reported.", markers: ["twelve new hospital contracts"], expectedSignal: "supports", expectedRisk: "low", insertAt: 7 },
  { id: "support-03", company: "Summit Payments", thesis: "Payment volume and merchant retention will continue increasing.", evidence: "Payment volume increased 31%, merchant retention reached 98%, and management observed broad-based demand across all customer groups.", markers: ["merchant retention reached 98%"], expectedSignal: "supports", expectedRisk: "low", insertAt: 3 },
  { id: "support-04", company: "Atlas Robotics", thesis: "Manufacturing automation demand will grow and the order backlog will convert into revenue.", evidence: "Automation orders rose 29%, 96% of scheduled backlog converted to revenue, and management raised full-year revenue guidance.", markers: ["96% of scheduled backlog"], expectedSignal: "supports", expectedRisk: "low", insertAt: 5 },
  { id: "support-05", company: "Cedar Security", thesis: "Enterprise cybersecurity subscriptions will grow with low customer churn.", evidence: "Enterprise subscription revenue grew 27%, annual customer churn fell to 2%, and no material security incident affected the service.", markers: ["customer churn fell to 2%"], expectedSignal: "supports", expectedRisk: "low", insertAt: 2 },
  { id: "support-06", company: "Bluewater Logistics", thesis: "Shipping demand will stay strong while fuel efficiency improves operating margin.", evidence: "Shipment volume grew 14%, fuel consumed per delivery declined 11%, and operating margin expanded by three percentage points.", markers: ["fuel consumed per delivery declined 11%"], expectedSignal: "supports", expectedRisk: "low", insertAt: 8 },
  { id: "support-07", company: "Orchard Software", thesis: "International software subscriptions will become a larger, profitable revenue stream.", evidence: "International subscription revenue grew 35%, the segment became profitable, and renewal rates remained above 96%.", markers: ["segment became profitable"], expectedSignal: "supports", expectedRisk: "low", insertAt: 1 },
  { id: "support-08", company: "Evergreen Energy", thesis: "Renewable generation capacity will increase under long-term contracted pricing.", evidence: "Renewable capacity increased 22%, 91% of output is covered by long-term fixed-price contracts, and all major projects remain on schedule.", markers: ["91% of output"], expectedSignal: "supports", expectedRisk: "low", insertAt: 6 },
  { id: "support-09", company: "Pioneer Learning", thesis: "Paid student enrollment and course completion will grow together.", evidence: "Paid enrollment grew 19%, course completion improved from 72% to 81%, and refund requests declined during the period.", markers: ["completion improved from 72% to 81%"], expectedSignal: "supports", expectedRisk: "low", insertAt: 4 },
  { id: "support-10", company: "Granite Data", thesis: "Database usage and net revenue retention will remain strong.", evidence: "Database usage grew 41%, net revenue retention was 124%, and management reported no material loss among its ten largest customers.", markers: ["net revenue retention was 124%"], expectedSignal: "supports", expectedRisk: "low", insertAt: 0 },

  { id: "contradict-01", company: "Redwood Commerce", thesis: "The largest retailers will renew contracts and support recurring revenue growth.", evidence: "The two largest retail customers terminated their contracts, recurring revenue declined 26%, and management withdrew its annual guidance.", markers: ["two largest retail customers terminated"], expectedSignal: "contradicts", expectedRisk: "high", insertAt: 8 },
  { id: "contradict-02", company: "Beacon Biotech", thesis: "The lead clinical trial will meet its endpoint and support regulatory approval.", evidence: "The lead trial failed its primary endpoint, enrollment was suspended, and management stated that additional financing will be required within six months.", markers: ["failed its primary endpoint"], expectedSignal: "contradicts", expectedRisk: "high", insertAt: 2 },
  { id: "contradict-03", company: "Metro Devices", thesis: "Demand for the flagship device will grow without major quality problems.", evidence: "Flagship device demand declined 34%, a safety defect triggered a global recall, and the company recorded a material warranty charge.", markers: ["safety defect triggered a global recall"], expectedSignal: "contradicts", expectedRisk: "high", insertAt: 5 },
  { id: "contradict-04", company: "Keystone Bank", thesis: "Credit losses will remain low and capital ratios will improve.", evidence: "Credit losses tripled, the common equity capital ratio fell below the internal target, and regulators required a remediation plan.", markers: ["Credit losses tripled"], expectedSignal: "contradicts", expectedRisk: "high", insertAt: 1 },
  { id: "contradict-05", company: "Aurora Foods", thesis: "Premium product growth will protect margins from commodity inflation.", evidence: "Premium product sales declined 21%, commodity costs reduced gross margin by nine percentage points, and management lowered its margin forecast.", markers: ["gross margin by nine percentage points"], expectedSignal: "contradicts", expectedRisk: "high", insertAt: 6 },
  { id: "contradict-06", company: "Vertex Telecom", thesis: "Subscriber growth will continue while network reliability improves.", evidence: "The company lost 18% of subscribers, network outages doubled, and the communications regulator opened a formal investigation.", markers: ["lost 18% of subscribers"], expectedSignal: "contradicts", expectedRisk: "high", insertAt: 4 },
  { id: "contradict-07", company: "Ironwood Construction", thesis: "The project backlog will convert on budget and without material delays.", evidence: "Three major projects were delayed indefinitely, estimated costs exceeded budget by 42%, and two customers initiated contract disputes.", markers: ["costs exceeded budget by 42%"], expectedSignal: "contradicts", expectedRisk: "high", insertAt: 7 },
  { id: "contradict-08", company: "Silverline Media", thesis: "Advertising demand and audience engagement will recover this year.", evidence: "Advertising revenue declined 30%, monthly active users fell 22%, and management expects further deterioration next quarter.", markers: ["monthly active users fell 22%"], expectedSignal: "contradicts", expectedRisk: "high", insertAt: 3 },
  { id: "contradict-09", company: "Prairie Motors", thesis: "Electric vehicle deliveries will grow while battery costs decline.", evidence: "Electric vehicle deliveries fell 28%, battery costs increased 17%, and the company paused construction of its next assembly line.", markers: ["battery costs increased 17%"], expectedSignal: "contradicts", expectedRisk: "high", insertAt: 0 },
  { id: "contradict-10", company: "Delta Insurance", thesis: "Claims severity will normalize and underwriting profitability will improve.", evidence: "Claims severity reached a record level, the underwriting business reported a substantial loss, and the company increased loss reserves by 38%.", markers: ["increased loss reserves by 38%"], expectedSignal: "contradicts", expectedRisk: "high", insertAt: 5 },

  { id: "unclear-01", company: "Juniper Analytics", thesis: "The new analytics product will produce profitable enterprise growth.", evidence: "The new analytics product launched this quarter. Management did not disclose product revenue, enterprise customers, churn, or profitability.", markers: ["did not disclose product revenue"], expectedSignal: "unclear", expectedRisk: "medium", insertAt: 4 },
  { id: "unclear-02", company: "Lighthouse Travel", thesis: "International bookings will recover to pre-downturn levels.", evidence: "International bookings increased from the prior quarter, but the company did not provide a pre-downturn comparison or future booking guidance.", markers: ["did not provide a pre-downturn comparison"], expectedSignal: "unclear", expectedRisk: "medium", insertAt: 1 },
  { id: "unclear-03", company: "Maple Semiconductors", thesis: "The next chip generation will gain market share while maintaining margins.", evidence: "The next chip generation entered limited production. Market share, customer adoption, unit economics, and gross margin were not reported.", markers: ["Market share, customer adoption"], expectedSignal: "unclear", expectedRisk: "medium", insertAt: 7 },
  { id: "unclear-04", company: "Cobalt Materials", thesis: "A new supply agreement will remove raw-material shortages.", evidence: "The company signed a non-binding supply memorandum, but volumes, pricing, start date, and enforceable purchase commitments remain unspecified.", markers: ["non-binding supply memorandum"], expectedSignal: "unclear", expectedRisk: "medium", insertAt: 2 },
  { id: "unclear-05", company: "Willow Health", thesis: "The telehealth service will reduce customer acquisition cost and improve retention.", evidence: "Telehealth visits increased, but the company changed its definitions and did not disclose comparable acquisition cost or retention figures.", markers: ["did not disclose comparable acquisition cost"], expectedSignal: "unclear", expectedRisk: "medium", insertAt: 6 },
  { id: "unclear-06", company: "Falcon Aerospace", thesis: "The prototype aircraft will receive certification next year.", evidence: "Prototype testing continued during the quarter. The regulator has not published a certification schedule, and management gave no expected approval date.", markers: ["no expected approval date"], expectedSignal: "unclear", expectedRisk: "medium", insertAt: 8 },
  { id: "unclear-07", company: "Elm Consumer", thesis: "A brand redesign will improve customer loyalty and pricing power.", evidence: "The brand redesign launched in selected stores. The company provided no loyalty, repeat-purchase, price realization, or controlled-test results.", markers: ["provided no loyalty"], expectedSignal: "unclear", expectedRisk: "medium", insertAt: 3 },
  { id: "unclear-08", company: "Riverbank Utilities", thesis: "Grid modernization will reduce outages and maintenance expenses.", evidence: "Grid modernization spending increased, but outage duration and maintenance expense were affected by a methodology change and are not comparable.", markers: ["are not comparable"], expectedSignal: "unclear", expectedRisk: "medium", insertAt: 0 },
  { id: "unclear-09", company: "Aspen Retail", thesis: "The loyalty program will increase spending by existing customers.", evidence: "Loyalty membership increased, but the company did not separate existing-customer spending from promotions or newly enrolled customers.", markers: ["did not separate existing-customer spending"], expectedSignal: "unclear", expectedRisk: "medium", insertAt: 5 },
  { id: "unclear-10", company: "Stonebridge Gaming", thesis: "The upcoming game will generate meaningful recurring digital revenue.", evidence: "The game remains under development. Release timing, preorder data, monetization design, and expected digital revenue were not disclosed.", markers: ["expected digital revenue were not disclosed"], expectedSignal: "unclear", expectedRisk: "medium", insertAt: 7 },
];

const NOISE = [
  "The board met regularly and reviewed the standard corporate calendar. Administrative policies were updated during the period.",
  "Foreign exchange rates changed compared with the prior period. The accounting presentation follows the same general reporting framework.",
  "The company renewed office leases and purchased ordinary information technology equipment for administrative employees.",
  "Directors approved the minutes from prior meetings. No change was made to the fiscal year or the registered corporate address.",
  "Cash was held at several financial institutions. Routine treasury activities continued under previously approved policies.",
  "The annual meeting materials were distributed electronically. Shareholders voted on the standard slate of governance proposals.",
  "Depreciation methods and useful-life estimates were reviewed. No material accounting-policy change was recorded for these items.",
  "The organization continued employee training and updated internal documentation. Head-office procedures remained substantially unchanged.",
];

function expanded(paragraph: string) {
  return Array.from({ length: 10 }, () => paragraph).join(" ");
}

export function evalDocument(testCase: AiEvalCase): ResearchDocument {
  const paragraphs = NOISE.map(expanded);
  paragraphs.splice(testCase.insertAt, 0, expanded(testCase.evidence));
  return { title: `${testCase.company} synthetic quarterly report`, text: paragraphs.join("\n\n"), url: `https://example.invalid/${testCase.id}`, date: "2026-06-30" };
}

