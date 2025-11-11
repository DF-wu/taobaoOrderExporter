export interface Root {
  error: string
  extra: Extra
  mainOrders: MainOrder[]
  page: Page
  query: Query
  tabs: Tab[]
}

export interface Extra {
  asyncRequestUrl: string
  carttaskServerPath: string
  followModulePath: string
  hasPageList: boolean
  i18n: string
  mainBizOrderIds: string
  rateGift: string
  showB2BMenu: boolean
  tbskipModulePath: string
}

export interface MainOrder {
  extra: Extra2
  id: string
  operations: Operation[]
  orderInfo: OrderInfo
  payInfo: PayInfo
  presentOrder: boolean
  seller: Seller
  statusInfo: StatusInfo
  subOrders: SubOrder[]
  tradeOperations: TradeOperation[]
}

export interface Extra2 {
  allowBuyAgain: boolean
  batch?: boolean
  batchConfirm?: boolean
  batchGroup: string
  batchGroupTips: string
  batchMaxCount: number
  bizType: number
  currency: string
  currencySymbol: string
  id: number
  inHold: boolean
  isShowSellerService: boolean
  needDisplay: boolean
  tradeStatus: string
  visibility: boolean
  closed?: boolean
  finish?: boolean
}

export interface Operation {
  id: string
  style: string
  text: string
  type: string
  url?: string
  config: Config
  action?: string
  data?: Data
  dataUrl?: string
}

export interface Config {
  kind: string
  style: string
}

export interface Data {
  body: string
  crossOrigin: boolean
  height: number
  title: string
  width: number
}

export interface OrderInfo {
  createDay: string
  createTime: string
  id: string
  b2C?: boolean
}

export interface PayInfo {
  actualFee: string
  icons: Icon[]
  postFees: PostFee[]
  currency: string
  currencySymbol: string
}

export interface Icon {
  linkTitle?: string
  linkUrl?: string
  type: number
  url: string
  title?: string
}

export interface PostFee {
  prefix: string
  suffix: string
  value: string
}

export interface Seller {
  alertStyle: number
  guestUser: boolean
  id: number
  nick: string
  notShowSellerInfo: boolean
  opeanSearch: boolean
  shopDisable: boolean
  shopName: string
  shopUrl: string
  wangwangType: string
  shopImg?: string
}

export interface StatusInfo {
  operations: Operation2[]
  text: string
  type: string
  url: string
}

export interface Operation2 {
  action?: string
  dataUrl?: string
  style: string
  text: string
  type: string
  id?: string
  url?: string
}

export interface SubOrder {
  id: number
  itemInfo: ItemInfo
  operations: Operation3[]
  priceInfo: PriceInfo
  quantity: Quantity
  returnAddressVO: ReturnAddressVo
}

export interface ItemInfo {
  extra?: Extra3[]
  id: number
  itemUrl: string
  pcH5SnapUrl: string
  pic: string
  serviceIcons: ServiceIcon[]
  skuId: number
  skuText: SkuText[]
  snapUrl: string
  snapshotUseH5: boolean
  title: string
  xtCurrent: boolean
}

export interface Extra3 {
  name: string
  value: string
  visible: string
}

export interface ServiceIcon {
  linkTitle: string
  linkUrl: string
  type: number
  url: string
  name?: string
  title?: string
}

export interface SkuText {
  name: string
  value: string
  visible: string
}

export interface Operation3 {
  action?: string
  attribute?: string
  dataUrl?: string
  style: string
  text: string
  url?: string
}

export interface PriceInfo {
  realTotal: string
  currency: string
  currencySymbol: string
  original?: string
}

export interface Quantity {
  count: string
}

export interface ReturnAddressVo {
  historyShow: boolean
}

export interface TradeOperation {
  style?: string
  text: string
  type: string
  orderData: OrderDaum[]
  orderExtra?: OrderExtra
  id?: string
  url?: string
  action?: string
  mtopParams?: MtopParams
}

export interface OrderDaum {
  id: number
  itemInfo: ItemInfo2
  operations: Operation4[]
  priceInfo: PriceInfo2
  quantity: Quantity2
  returnAddressVO: ReturnAddressVo2
}

export interface ItemInfo2 {
  extra?: Extra4[]
  id: number
  itemUrl: string
  pcH5SnapUrl: string
  pic: string
  serviceIcons: ServiceIcon2[]
  skuId: number
  skuText: SkuText2[]
  snapUrl: string
  snapshotUseH5: boolean
  title: string
  xtCurrent: boolean
}

export interface Extra4 {
  name: string
  value: string
  visible: string
}

export interface ServiceIcon2 {
  linkTitle: string
  linkUrl: string
  type: number
  url: string
  name?: string
  title?: string
}

export interface SkuText2 {
  name: string
  value: string
  visible: string
}

export interface Operation4 {
  action?: string
  attribute?: string
  dataUrl?: string
  style: string
  text: string
  url?: string
}

export interface PriceInfo2 {
  realTotal: string
  currency: string
  currencySymbol: string
  original?: string
}

export interface Quantity2 {
  count: string
}

export interface ReturnAddressVo2 {
  historyShow: boolean
}

export interface OrderExtra {
  allowBuyAgain: boolean
  batchGroup: string
  batchGroupTips: string
  batchMaxCount: number
  bizType: number
  currency: string
  currencySymbol: string
  finish?: boolean
  id: number
  inHold: boolean
  isShowSellerService: boolean
  needDisplay: boolean
  tradeStatus: string
  visibility: boolean
  batch?: boolean
  batchConfirm?: boolean
}

export interface MtopParams {
  api: string
  v: string
  ecode: number
  timeout: number
  dataType: string
  valueType: string
  type: string
  data: Data2
}

export interface Data2 {
  add: Add
  cartFrom: string
  exParams: ExParams
}

export interface Add {
  items: Item[]
}

export interface Item {
  itemId: number
  skuId: number
  quantity: number
}

export interface ExParams {
  repeatPurchaseChannel: string
}

export interface Page {
  currentPage: number
  globalCodes: any[]
  pageSize: number
  prefetchCount: number
  queryForTitle: boolean
  totalNumber: number
  totalPage: number
}

export interface Query {
  canGetHistoryCount: boolean
  cartItemDOList: any[]
  extra: Extra5
  historyCount: number
  needQueryHistory: boolean
  onlineCount: number
  pageNum: number
  pageSize: number
  queryForV2: boolean
  unionSearchPageNum: number
  unionSearchTotalNum: number
}

export interface Extra5 {}

export interface Tab {
  code: string
  herf: string
  selected?: boolean
  text: string
  type: string
  count?: number
}
