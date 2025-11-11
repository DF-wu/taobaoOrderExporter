export interface Root {
  traceId: string
  deliveryInfo: DeliveryInfo
  mainOrder: MainOrder
  orderBar: OrderBar
  crumbs: Crumb[]
  operationsGuide: OperationsGuide[]
  customService: CustomService
  detailExtra: DetailExtra
}

export interface DeliveryInfo {
  arriveTime: string
  logisticsName: string
  sellerNick: string
  tspInfo: TspInfo
  address: string
  usePrivacytPhone: number
  privacytPhoneHasExpired: number
  showLogistics: boolean
  shipType: string
  logisticsNum: string
  showTSP: boolean
  asyncLogisticsUrl: string
}

export interface TspInfo {}

export interface MainOrder {
  seller: Seller
  statusInfo: StatusInfo
  bizCode: string
  columns: string[]
  subOrders: SubOrder[]
  operations: any[]
  wirelessOrderInfo: WirelessOrderInfo
  extra: Extra3
  tradeStatus: string
  orderInfo: OrderInfo
  id: string
  payInfo: PayInfo
  presentOrder: boolean
}

export interface Seller {
  nick: string
  opeanSearch: boolean
  wangwangType: string
  mail: string
  shopDisable: boolean
  id: number
  guestUser: boolean
  alipayAccount: string
  notShowSellerInfo: boolean
  alertStyle: number
}

export interface StatusInfo {
  text: string
  type: string
}

export interface SubOrder {
  idStr: string
  priceInfo: string
  quantity: string
  service: any[]
  extra: Extra
  tradeStatus: TradeStatu[]
  id: number
  itemInfo: ItemInfo
}

export interface Extra {
  overSold: boolean
  alicommunOrderDirect: boolean
  needShowQuantity: number
  xt: boolean
  needDisplay: boolean
  payStatus: number
  opWeiQuan: boolean
  notSupportReturn: boolean
}

export interface TradeStatu {
  type: string
  content: Content[]
}

export interface Content {
  type: string
  value: string
}

export interface ItemInfo {
  skuText: SkuText[]
  auctionUrl: string
  extra: Extra2[]
  pic: string
  title: string
  serviceIcons: ServiceIcon[]
  skuId: number
}

export interface SkuText {
  type: string
  content: Content2[]
}

export interface Content2 {
  type: string
  value: Value
}

export interface Value {
  name: string
  value: string
  type: string
}

export interface Extra2 {
  visible: string
  highLight: boolean
  name: string
  value: string
}

export interface ServiceIcon {
  linkTitle: string
  linkUrl: string
  type: number
  url: string
}

export interface WirelessOrderInfo {
  showConsignTime: boolean
}

export interface Extra3 {
  unionTitle: boolean
  inHold: boolean
  isShowSellerService: boolean
}

export interface OrderInfo {
  lines: Line[]
  type: string
}

export interface Line {
  type: string
  content: Content3[]
}

export interface Content3 {
  type: string
  value: Value2
}

export interface Value2 {
  name: string
  value: any
  type?: string
}

export interface PayInfo {
  showPayDetail: boolean
  feeMess: FeeMess[]
  cod: boolean
  sendPromotions: any[]
  actualFee: ActualFee
  fullPromotion: FullPromotion
}

export interface FeeMess {
  visible: string
  name: string
  value: string
  highLight?: boolean
}

export interface ActualFee {
  visible: string
  highLight: boolean
  name: string
  value: string
}

export interface FullPromotion {
  valid: boolean
}

export interface OrderBar {
  nodes: Node[]
  currentStepIndex: number
  currentIndex: number
}

export interface Node {
  date?: string
  index: number
  text: string
}

export interface Crumb {
  text: string
  url: string
}

export interface OperationsGuide {
  layout: string
  lines: Line2[]
  type: string
}

export interface Line2 {
  type: string
  content: Content4[]
}

export interface Content4 {
  type: string
  value: any
}

export interface CustomService {
  display: string
  type: string
  content: Content5[]
}

export interface Content5 {
  type: string
  value: string
}

export interface DetailExtra {
  op: boolean
  ccc: boolean
  sellerMemoInfo: SellerMemoInfo
  refundByTb: boolean
  inRefund: boolean
  enableTmallhkTaxDetail: boolean
  b2c: boolean
  tradeEnd: boolean
  outShopOrder: boolean
  wakeupOrder: boolean
  success: boolean
  newSellerMemo: boolean
  viewed_flag: boolean
}

export interface SellerMemoInfo {
  flagPic: string
  flagId: number
}
