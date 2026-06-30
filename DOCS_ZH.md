# 使用说明

## 网站搜索功能

### 筛选器说明

网站顶部工具栏提供以下筛选器，所有筛选器实时生效，无需点击搜索按钮。

| 筛选器 | 说明 |
|---|---|
| Load port | 装货港 |
| Load country | 装货国家 |
| Discharge port | 卸货港 |
| Discharge country | 卸货国家 |
| Company | 发件公司（邮箱域名） |
| Size class | 船型等级（如 Panamax、Supramax） |
| Tonnage (MT) | 按吨位数值筛选 |
| 第一个日期框 | Laycan 日期范围筛选 |
| 第二个日期框 | 发送日期（仅显示该日期及之后的邮件） |
| Type 下拉框 | 按类型筛选：Cargo（租船方需要船）/ Shipping（船东提供船）/ Unknown |

### 逗号分隔多值搜索（OR 逻辑）

以下筛选器支持用逗号分隔多个关键词，系统会显示符合**任意一个**关键词的结果：

- Load port
- Load country
- Discharge port
- Discharge country
- Company
- Size class
- Tonnage (MT)

**示例：**
- 在 Load country 中输入 `China, Vietnam` → 显示装货国为中国**或**越南的所有记录
- 在 Tonnage 中输入 `50000, 75000` → 显示吨位范围包含 50,000 MT **或** 75,000 MT 的记录
- 在 Size class 中输入 `Panamax, Supramax` → 显示船型为巴拿马型**或**超灵便型的记录

### 吨位筛选说明

吨位筛选器根据数据库中存储的 `tonnage_min` 和 `tonnage_max` 范围进行匹配。输入的数值若落在某条记录的吨位范围内，该记录即会显示。

---

## 邮件轮询机制

### 启动时

程序启动后立即执行一次完整的轮询流程，无需等待。仅拉取收件箱中**最新的 100 封邮件**（由环境变量 `POLL_TOTAL_AMO` 控制，默认值为 100）。

### 定时轮询

每隔 **15 分钟**自动执行一次轮询，循环持续运行，只要程序保持开启即可。

### 轮询流程（POLL_TYPE=1，即 Gmail 实时模式）

```
启动 / 每15分钟
        ↓
连接 Gmail IMAP (imap.gmail.com:993, TLS加密)
        ↓
获取收件箱所有邮件 UID，从最新邮件开始遍历
        ↓
对每封邮件：
  ├─ 黑名单发件人？→ 跳过（continue）
  ├─ 已存在数据库中？→ 停止本次轮询（break）
  └─ 正常邮件 → 加入待分类列表
        ↓
断开 IMAP 连接
        ↓
第一轮分类（Haiku / Gemini Flash）
  批量判断每封邮件是否为 MARITIME（航运相关）或 UNKNOWN
        ↓
第二轮分类（Sonnet / Gemini Flash）
  对 MARITIME 邮件提取：
  - 类型（cargo / shipping）
  - 吨位（最小值、最大值、船型等级）
  - 装货港 / 卸货港
  - Laycan 起止日期
  - 货物类型
        ↓
第三轮分类（仅 Anthropic 模式，Haiku）
  将港口名称转换为所在国家
        ↓
写入数据库
```

### 重复检测

系统以邮件的 `Message-ID` 作为唯一标识。轮询时一旦遇到数据库中已存在的邮件，即停止继续向前获取，避免重复处理历史邮件。

### 分类器选择

通过环境变量 `KEY_TYPE` 控制：

| KEY_TYPE | 使用的分类器 |
|---|---|
| `0` | Gemini 2.5 Flash（免费额度，有速率限制，自动重试） |
| `1` | Anthropic Claude（Haiku 初筛 + Sonnet 精分 + Haiku 港口国家识别） |

### 注意事项

- 程序必须保持运行，关闭后轮询停止
- Gemini 免费额度限制每分钟 5 次请求，超限后自动等待 60 秒重试
- 吨位若仅有船型等级（如 Panamax）而无具体数值，`tonnage_min` / `tonnage_max` 将为空，待后续手动补充对应吨位范围
