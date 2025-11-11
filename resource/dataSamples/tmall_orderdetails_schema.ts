export interface Root {
  ad: Ad
  amount: Amount
  basic: Basic
  bizCode: string
  orders: Orders
  other: Other
  overStatus: OverStatus
  stepbar: Stepbar
  top: Top
  traceId: string
  tradeStatus: string
}

export interface Ad {
  banner: Banner
  p4pAdvert: P4pAdvert
  salePromotion: SalePromotion
}

export interface Banner {}

export interface P4pAdvert {
  params: Params
}

export interface Params {
  p4p: string
}

export interface SalePromotion {
  params: Params2
}

export interface Params2 {
  aldCfgAppId: string
  itemIds: string
  aldCfgName: string
}

export interface Amount {
  count: Count[][]
  priceDetailBuilder: PriceDetailBuilder
  promotion: Promotion[]
}

export interface Count {
  content: Content[]
  key: string
}

export interface Content {
  data: Data
  layout: Layout
  root: string
  type: string
}

export interface Data {
  money: Money
  colon: Colon
  titleLink: TitleLink
}

export interface Money {
  css: Css
  text: string
  type: string
}

export interface Css {
  width: string
  color?: string
  fontSize?: string
  fontWeight?: string
}

export interface Colon {
  text: string
  type: string
}

export interface TitleLink {
  css: Css2
  text: string
  type: string
}

export interface Css2 {
  color?: string
  fontSize?: string
  fontWeight?: string
}

export interface Layout {
  row1: Row1
  root: Root2
}

export interface Row1 {
  children: string[]
}

export interface Root2 {
  children: string[]
}

export interface PriceDetailBuilder {}

export interface Promotion {
  content: Content2[]
  key: string
}

export interface Content2 {
  data: Data2
  layout: Layout2
  root: string
  type: string
}

export interface Data2 {
  money: Money2
}

export interface Money2 {
  css: Css3
  text: string
  type: string
}

export interface Css3 {
  width: string
}

export interface Layout2 {
  row1: Row12
  root: Root3
}

export interface Row12 {
  children: string[]
}

export interface Root3 {
  children: string[]
}

export interface Basic {
  lists: List[]
  log: Log
  title: string
}

export interface List {
  content: Content3[]
  key: string
}

export interface Content3 {
  text: string
  type: string
  direction?: string
  moreList?: MoreList[]
  noHover?: boolean
}

export interface MoreList {
  content: Content4[]
  key: string
}

export interface Content4 {
  type: string
  text?: string
}

export interface Log {}

export interface Orders {
  id: number
  list: List2[]
}

export interface List2 {
  logistic: Logistic
  status: Status[]
}

export interface Logistic {
  content: Content5[]
  key: string
}

export interface Content5 {
  companyName: string
  mailNo: string
  text: string
  type: string
  url: string
}

export interface Status {
  statusInfo: StatusInfo[]
  subOrders: SubOrder[]
}

export interface StatusInfo {
  text?: string
  type: string
  serverTime?: string
  targetTime?: string
}

export interface SubOrder {
  itemInfo: ItemInfo
  priceInfo: PriceInfo[]
  quantity: string
}

export interface ItemInfo {
  auctionUrl: string
  extra: Extra[]
  itemUrl: string
  pic: string
  serviceIcons: ServiceIcon[]
  skuText: SkuText[]
  snapUrl: string
  title: string
}

export interface Extra {
  name: string
  value: string
  visible: string
}

export interface ServiceIcon {
  linkTitle: string
  linkUrl: string
  name: string
  title: string
  type: number
  url: string
}

export interface SkuText {
  content: Content6[]
  key: string
}

export interface Content6 {
  text: string
  type: string
}

export interface PriceInfo {
  text: string
  type: string
}

export interface Other {
  content: any[]
}

export interface OverStatus {
  explain: any[]
  operate: Operate[]
  prompt: Prompt[]
  status: Status2
}

export interface Operate {
  content: Content7[]
  key: string
}

export interface Content7 {
  action: string
  id: string
  pointUrl?: string
  text: string
  type: string
  url?: string
  data?: Data3
  dataUrl?: string
}

export interface Data3 {
  body: string
  crossOrigin: boolean
  height: number
  title: string
  width: number
}

export interface Prompt {
  content: Content8[]
  key: string
}

export interface Content8 {
  afterText?: string
  preText?: string
  serverTime?: string
  targetTime?: string
  type: string
  text?: string
  companyName?: string
  mailNo?: string
  url?: string
}

export interface Status2 {
  content: Content9[]
  iconUrl: string
}

export interface Content9 {
  text: string
  type: string
}

export interface Stepbar {
  current: number
  options: Option[]
}

export interface Option {
  content: string
  time?: string
}

export interface Top {
  crumbs: Crumbs
  hotline: Hotline
}

export interface Crumbs {
  content: Content10[]
  key: string
}

export interface Content10 {
  action: string
  text: string
  type: string
  url: string
}

export interface Hotline {
  content: Content11[]
  key: string
}

export interface Content11 {
  text: string
  type: string
}
