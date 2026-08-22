# QuetUnfollowIG

Cloud-backed Instagram Followers/Following change tracker with a Chrome/Chromium extension, a Next.js main site, and Supabase snapshot history.

Production: https://quet-unfollow-ig.vercel.app

## Hướng dẫn nhanh: Xem ai không còn follow bạn

Dành cho người dùng phổ thông chỉ muốn đi thẳng tới kết quả **xem tài khoản nào không còn follow mình**.

**Flow ngắn gọn:**

`Đăng nhập Instagram → mở extension → copy Pairing key → mở main site → để Target trống → Connect → Run crawl lần 1 → chờ một khoảng thời gian → Run crawl lần 2 → xem Who changed → No longer follows you`

### Các bước thực hiện

1. **Cài hoặc cập nhật extension QuetUnfollowIG** trong Chrome. Nếu vừa cập nhật source, vào `chrome://extensions` và bấm **Reload**.
2. **Đăng nhập Instagram** trên `instagram.com` bằng chính tài khoản bạn muốn kiểm tra ai không còn follow.
3. **Mở popup extension** và kiểm tra Instagram session đã sẵn sàng, đồng thời Cloud Workspace đang ở trạng thái **Connected**.
4. Trong popup extension, **copy Pairing key**.
5. Mở main site: `https://quet-unfollow-ig.vercel.app`.
6. Paste Pairing key vào ô **Pairing key**.
7. **Để trống ô Instagram target** nếu mục tiêu là kiểm tra chính tài khoản đang đăng nhập.
8. Bấm **Connect**.
9. Khi nút **Run crawl** sáng lên, bấm **Run crawl** và chờ crawl hoàn tất.
10. **Lần crawl đầu tiên chỉ tạo mốc dữ liệu ban đầu**, vì vậy chưa thể biết ai đã biến mất khỏi Followers.
11. Sau một khoảng thời gian, mở lại website, Connect và **Run crawl lần thứ hai cho cùng tài khoản**.
12. Khi lần crawl thứ hai hoàn tất, cuộn xuống **Changes** để xem số lượng thay đổi, sau đó xuống **Who changed**.
13. Xem nhóm **No longer follows you**. Đây là danh sách những tài khoản có trong Followers ở lần crawl trước nhưng không còn xuất hiện trong lần crawl mới nhất.

> **Quan trọng:** cần ít nhất **2 complete runs** của cùng một tài khoản mới có kết quả so sánh. Một tài khoản biến mất khỏi Followers thường có thể là đã unfollow bạn, nhưng dữ liệu này không tự chứng minh nguyên nhân. Block, deactivate/xóa tài khoản, thay đổi visibility hoặc bất thường phía Instagram cũng có thể làm tài khoản biến mất khỏi danh sách.

Nếu chỉ cần xem ai không còn follow mình, bạn **không cần bật Professional Mode**. Chế độ mặc định đã hiển thị số lượng thay đổi và danh sách account cụ thể trong **Who changed**.

## Hướng dẫn sử dụng chi tiết

Phần này dành cho người dùng thông thường muốn cài đặt và sử dụng QuetUnfollowIG mà không cần hiểu sâu về mã nguồn.

### 1. Chuẩn bị trước khi sử dụng

Bạn cần:

- trình duyệt Chrome hoặc một trình duyệt Chromium hỗ trợ extension dạng unpacked;
- một phiên Instagram đang đăng nhập trên `instagram.com` trong chính trình duyệt đó;
- source code của repository này đã được tải về máy;
- kết nối Internet để extension truy cập Instagram, Supabase và main site.

QuetUnfollowIG **không yêu cầu nhập mật khẩu Instagram vào ứng dụng**. Extension sử dụng phiên Instagram mà trình duyệt hiện tại đã đăng nhập.

### 2. Cài extension lần đầu

1. Tải hoặc clone repository này về máy.
2. Mở Chrome và truy cập:

   `chrome://extensions`

3. Bật **Developer mode** ở góc trên bên phải.
4. Chọn **Load unpacked**.
5. Chọn thư mục gốc của repository `QuetUnfollowIG`.
6. Kiểm tra extension **QuetUnfollowIG** đã xuất hiện trong danh sách.
7. Phiên bản hiện tại phải hiển thị là **1.4.0**.
8. Nên ghim extension lên thanh công cụ Chrome để thao tác nhanh hơn.

Sau mỗi lần bạn cập nhật source code từ GitHub, hãy quay lại `chrome://extensions` và bấm **Reload** trên extension QuetUnfollowIG. Nếu không reload, Chrome có thể tiếp tục chạy code cũ dù repository trên máy đã được cập nhật.

### 3. Kiểm tra phiên Instagram

1. Mở một tab mới và truy cập `https://www.instagram.com/`.
2. Đảm bảo tài khoản Instagram cần sử dụng đang đăng nhập bình thường.
3. Nên thử mở profile của chính bạn và một vài danh sách Followers/Following để chắc rằng phiên hiện tại không bị checkpoint hoặc yêu cầu đăng nhập lại.
4. Sau đó mở popup của extension QuetUnfollowIG.

Nếu extension nhận diện được phiên đăng nhập, popup sẽ hiển thị trạng thái tương tự:

`Phiên Instagram sẵn sàng · viewer ID ...`

Nếu popup báo không tìm thấy phiên Instagram, hãy tải lại `instagram.com`, đăng nhập lại nếu cần rồi mở lại extension.

### 4. Thiết lập Cloud Workspace lần đầu

QuetUnfollowIG dùng Supabase để lưu các lần crawl hoàn chỉnh và tính toán sự thay đổi giữa các snapshot.

Ở thiết bị đầu tiên:

1. Mở popup extension.
2. Kiểm tra khu vực **Cloud Workspace · Supabase**.
3. Extension sẽ cố gắng tự tạo Cloud Workspace nếu hệ thống chưa có workspace nào.
4. Khi thành công, trạng thái sẽ chuyển sang **Connected**.
5. Popup sẽ hiển thị **Cloud Workspace Key**.

Hãy lưu Cloud Workspace Key ở một nơi an toàn nếu bạn có ý định sử dụng nhiều máy. Đây là khóa cho phép thiết bị khác truy cập cùng history và diff trên Supabase.

**Không đăng Cloud Workspace Key công khai và không paste khóa này vào main website.**

### 5. Phân biệt hai loại key

QuetUnfollowIG sử dụng hai credential khác nhau:

- **Pairing key**: dùng để kết nối main website với extension trên cùng trình duyệt. Key này có thể được tạo lại bằng nút tạo pairing key mới trong popup.
- **Cloud Workspace Key**: dùng để kết nối extension với cùng một Cloud Workspace trên Supabase. Đây là khóa đồng bộ history giữa nhiều thiết bị.

Main website chỉ cần **Pairing key**. Main website không cần và không nên nhận Cloud Workspace Key.

### 6. Kết nối main website với extension

1. Mở popup extension.
2. Tìm phần **Live website pairing key**.
3. Bấm **Copy** để copy pairing key.
4. Mở main site:

   `https://quet-unfollow-ig.vercel.app`

5. Ở phần **Control**, paste pairing key vào ô **Pairing key**.
6. Nếu muốn crawl tài khoản Instagram đang đăng nhập, để trống ô **Instagram target**.
7. Nếu muốn crawl một tài khoản khác, nhập một trong các dạng:

   - `username`
   - `@username`
   - URL profile Instagram, ví dụ `https://www.instagram.com/username/`

8. Bấm **Connect**.

Nếu kết nối thành công, website sẽ nhận diện extension, viewer Instagram hiện tại và target được chọn.

Nếu website báo **Extension bridge offline**, hãy:

1. kiểm tra extension đang bật;
2. reload extension tại `chrome://extensions`;
3. reload main website;
4. copy lại pairing key từ popup nếu bạn vừa rotate key.

### 7. Crawl chính tài khoản đang đăng nhập

Đây là trường hợp phổ biến nhất nếu mục tiêu của bạn là theo dõi ai không còn follow bạn hoặc tài khoản nào không còn nằm trong Following của bạn.

1. Đảm bảo main site đã Connect thành công.
2. Để ô **Instagram target** trống.
3. Bấm **Run crawl**.
4. Extension sẽ lần lượt crawl:

   - Followers;
   - Following.

5. Trong lúc crawl, không nên spam nút Run crawl hoặc chạy thêm một crawl từ popup.
6. Khi hoàn tất, snapshot sẽ được upload lên Supabase.
7. Chỉ khi backend xác nhận snapshot hợp lệ thì run mới được đánh dấu là `complete`.

Lần crawl hoàn chỉnh đầu tiên đóng vai trò mốc dữ liệu đầu tiên. Vì chưa có lần trước để so sánh nên phần Changes chưa thể kết luận account nào đã xuất hiện hoặc biến mất.

### 8. Crawl một tài khoản khác

Bạn có thể crawl một tài khoản khác nếu session Instagram hiện tại thực sự có quyền xem danh sách Followers/Following của tài khoản đó.

1. Nhập username hoặc URL profile vào ô **Instagram target**.
2. Bấm **Connect** để resolve target.
3. Kiểm tra website hiển thị đúng username/target mong muốn.
4. Bấm **Run crawl**.

Các trường hợp thường hoạt động:

- tài khoản public mà Instagram cho phép phiên hiện tại mở danh sách;
- private account mà tài khoản Instagram đang đăng nhập đã có quyền xem danh sách đó.

Extension **không bypass private account**. Nếu chính giao diện Instagram không cho session hiện tại xem Followers/Following của target, crawler cũng có thể bị từ chối.

### 9. Crawl lần thứ hai và đọc kết quả thay đổi

Sau một khoảng thời gian, hãy crawl lại **cùng target**.

Supabase sẽ so snapshot hoàn chỉnh mới nhất với snapshot hoàn chỉnh ngay trước đó theo thời điểm dữ liệu được capture.

Main site chia thay đổi thành bốn nhóm:

#### No longer follows you / No longer follows target

Account từng xuất hiện trong Followers ở lần trước nhưng không còn xuất hiện ở lần mới nhất.

Đối với chính tài khoản của bạn, đây là nhóm thường được dùng để phát hiện account **có khả năng đã unfollow bạn**.

Tuy nhiên, việc một account biến mất khỏi Followers không tự động chứng minh họ chủ động bấm Unfollow. Account đó cũng có thể đã:

- deactivate tài khoản;
- xóa tài khoản;
- block bạn;
- thay đổi visibility;
- hoặc Instagram trả dữ liệu khác do trạng thái nền tảng.

#### No longer in your Following / Target no longer follows

Account từng xuất hiện trong Following ở lần trước nhưng không còn ở lần mới nhất.

Nếu target là chính bạn, nhóm này cho biết tài khoản nào đã biến mất khỏi danh sách Following của bạn giữa hai lần crawl.

#### New in your Followers / New followers

Account không có trong Followers ở lần trước nhưng xuất hiện trong lần crawl mới nhất.

#### New in your Following / New in target Following

Account không có trong Following ở lần trước nhưng xuất hiện trong lần crawl mới nhất.

### 10. Xem chính xác account nào thay đổi

Cuộn xuống section **Who changed**.

Thay vì chỉ hiển thị một con số tổng, website hiển thị danh sách account cụ thể thuộc từng nhóm thay đổi.

Mỗi row có thể chứa:

- username;
- display name;
- Instagram user ID;
- nút mở profile nếu username hiện tại có sẵn.

Danh sách này được tính từ hai complete cloud runs gần nhất, không phải sample ngẫu nhiên.

### 11. Professional Mode

Mặc định website chạy ở chế độ đơn giản để tập trung vào kết quả chính.

Bật **Professional Mode** nếu bạn muốn xem thêm dữ liệu kỹ thuật như:

- trạng thái extension bridge;
- số trang pagination;
- số account đã nhận được;
- latency của từng page;
- elapsed time;
- target numeric Instagram ID;
- viewer consistency;
- Cloud Workspace status;
- history các complete runs;
- run ID;
- sample dữ liệu Followers/Following;
- validation/integrity information.

Professional Mode hữu ích khi bạn cần kiểm tra một crawl có đáng tin cậy hay đang gặp bất thường.

### 12. Hiểu trạng thái `complete` và `failed`

Một crawl chỉ được dùng để tính diff khi backend đánh dấu nó là `complete`.

Một run chỉ trở thành `complete` sau khi:

1. crawl Followers kết thúc pagination;
2. crawl Following kết thúc pagination;
3. toàn bộ account đã crawl được upload lên Supabase;
4. số membership trên Supabase khớp với số crawler báo cáo;
5. nếu Instagram cung cấp expected Followers/Following count, kết quả phải vượt qua completeness check của backend.

Nếu crawler phát hiện dữ liệu pagination đáng ngờ như duplicate numeric ID, cursor bị lặp hoặc page không nhất quán, run sẽ bị hủy thay vì tạo một diff có nguy cơ sai.

Một run `failed` hoặc incomplete sẽ **không được dùng làm mốc so sánh** cho lần crawl sau.

### 13. Sử dụng trên thiết bị thứ hai

Nếu muốn dùng cùng history trên một máy khác:

1. Cài QuetUnfollowIG extension trên máy thứ hai.
2. Reload extension sau khi cài.
3. Đăng nhập Instagram trên trình duyệt máy thứ hai.
4. Lấy **Cloud Workspace Key** từ thiết bị đã setup trước đó.
5. Mở popup extension trên máy thứ hai.
6. Paste key vào ô Cloud Workspace.
7. Bấm **Connect existing**.
8. Khi trạng thái chuyển sang **Connected**, máy thứ hai đã dùng chung cloud history.
9. Main website trên máy thứ hai vẫn sử dụng **pairing key riêng của extension trên máy thứ hai**.

Không copy pairing key giữa các máy với mục đích thay thế Cloud Workspace Key; hai loại key có chức năng khác nhau.

### 14. Khi đổi tài khoản Instagram đang đăng nhập

Nếu bạn logout Instagram A rồi login Instagram B trong cùng browser:

1. reload `instagram.com`;
2. mở lại popup extension để kiểm tra viewer ID đã thay đổi;
3. trên main site bấm Connect lại trước khi crawl.

Đối với private target, kết quả giữa hai viewer khác nhau có thể khác nhau vì mỗi viewer có quyền xem khác nhau. Professional Mode sẽ cảnh báo nếu latest và previous complete run sử dụng viewer khác nhau.

### 15. Những việc không nên làm khi đang crawl

Để giảm nguy cơ dữ liệu không ổn định hoặc bị Instagram rate-limit:

- không spam **Run crawl** liên tục;
- không chạy crawl đồng thời từ main site và popup;
- không logout/chuyển tài khoản Instagram giữa lúc crawler đang chạy;
- không refresh hoặc reload extension giữa lúc crawl;
- không repeatedly crawl account rất lớn trong khoảng thời gian ngắn;
- nếu gặp HTTP 429, nên dừng và chờ trước khi thử lại.

Extension hiện cũng có mutex: một extension instance chỉ cho phép một crawler hoạt động tại một thời điểm.

### 16. Một số lỗi thường gặp

#### `Không tìm thấy phiên Instagram`

Nguyên nhân thường là extension không đọc được session hiện tại.

Cách xử lý:

1. mở `instagram.com`;
2. đăng nhập lại nếu cần;
3. reload trang Instagram;
4. mở lại popup extension.

#### `Extension bridge offline`

1. vào `chrome://extensions`;
2. kiểm tra QuetUnfollowIG đang bật;
3. bấm **Reload**;
4. reload `quet-unfollow-ig.vercel.app`;
5. copy/paste lại pairing key.

#### `Pairing key không hợp lệ`

Pairing key trên website không còn khớp với extension hiện tại.

Hãy copy pairing key mới từ popup. Nếu trước đó bạn đã bấm tạo pairing key mới thì key cũ lập tức không còn hợp lệ.

#### `Cloud Workspace Key không hợp lệ`

Kiểm tra bạn có paste đúng Cloud Workspace Key hay không. Không dùng pairing key ở ô này.

#### HTTP 429 / rate limit

Instagram đang giới hạn request từ session hiện tại. Không nên tiếp tục retry liên tục. Hãy chờ rồi mới thử lại.

#### Crawl bị hủy vì duplicate ID / cursor loop / pagination không nhất quán

Đây là cơ chế bảo vệ dữ liệu. Extension cố tình bỏ run đó để tránh tạo false unfollow result. Hãy chờ một lúc rồi crawl lại thay vì coi snapshot lỗi là dữ liệu hợp lệ.

#### Main site không hiển thị Changes sau lần crawl đầu

Đây là hành vi bình thường. Cần ít nhất **hai complete runs của cùng một target** để tính sự thay đổi.

### 17. Quy trình sử dụng khuyến nghị

Một workflow đơn giản và an toàn:

1. đăng nhập Instagram;
2. kiểm tra extension báo session ready;
3. mở main site;
4. paste pairing key;
5. chọn target;
6. bấm Connect;
7. chạy crawl đầu tiên;
8. chờ một khoảng thời gian phù hợp;
9. crawl lại cùng target;
10. xem **Changes** để biết số lượng thay đổi;
11. xem **Who changed** để biết account cụ thể;
12. bật Professional Mode nếu cần kiểm tra history hoặc độ tin cậy của run.

Nếu mục tiêu chính của bạn là theo dõi tài khoản cá nhân, hãy giữ **Instagram target trống** để crawler theo dõi chính account đang đăng nhập.

## What it does

The extension uses the Instagram session already signed in on `instagram.com` to crawl relationship lists that the current session is allowed to see. Complete snapshots are uploaded to Supabase. The backend compares each target with its immediately previous complete snapshot and records:

- accounts that no longer follow the target;
- accounts newly following the target;
- accounts the target unfollowed;
- accounts the target newly followed.

The main site shows both the counts and the exact Instagram accounts in each change category.

A disappearance is an observed list difference, not proof of intent. Deactivation, deletion, blocking, visibility changes, or Instagram-side inconsistencies can also make an account disappear from a list.

## Architecture

A normal hosted website cannot reuse another origin's authenticated Instagram session. Instagram requests therefore remain inside the browser extension.

Data flow:

`Next.js main site -> paired web bridge -> MV3 service worker -> Instagram -> Supabase Edge Function -> PostgreSQL`

Important boundaries:

- Instagram cookies never go to the Next.js site or Supabase.
- The browser extension performs the Instagram GET requests.
- Supabase is the authoritative source for completed snapshot history and diffs.
- `chrome.storage.local` is only a compact cache in schema v4; it no longer keeps 30 full relationship arrays.
- The main site never receives the Cloud Workspace Key.

## Supported targets

Enter a username, `@username`, Instagram profile URL, or leave Target blank for the currently signed-in account.

The crawler can work with:

- your own signed-in account;
- public accounts whose relationship lists Instagram exposes to the current session;
- private accounts when the current signed-in session actually has permission to open those lists.

The extension does not bypass private-profile access controls and does not use another person's session.

## Cloud history and cross-device use

All devices that use the same Cloud Workspace Key share the same targets, completed runs, and diffs.

On the first device, the extension attempts to provision the workspace automatically. The generated Cloud Workspace Key stays inside extension storage and can be copied intentionally from the popup for another device.

On another device:

1. Install/reload the extension.
2. Open the extension popup.
3. Paste the Cloud Workspace Key from the first device.
4. Choose **Connect existing**.

Treat the Cloud Workspace Key as a secret. Losing it means a new device cannot authenticate to the existing cloud history.

## Pairing key vs Cloud Workspace Key

They are different credentials:

- **Pairing key**: authorizes the main site in the same browser to command the extension. Rotate it if it is exposed.
- **Cloud Workspace Key**: authenticates the extension to the shared Supabase workspace across devices. Do not paste it into the main site.

The web bridge only allows `GET_STATUS` and `CRAWL_NOW` and is restricted to the production aliases plus localhost development.

## Snapshot integrity

A crawl is not considered historical truth merely because Instagram returned some users.

A run becomes `complete` only when:

1. Followers pagination finishes.
2. Following pagination finishes.
3. Every crawled membership is uploaded to Supabase.
4. Supabase verifies uploaded counts exactly match crawler counts.
5. When Instagram exposes profile relationship counts, the crawl also passes a count-completeness tolerance check.

If upload is partial or the crawl count is materially inconsistent with an available expected count, the run is marked `failed` and is excluded from unfollow inference.

The backend orders runs by the time the relationship snapshot was captured (`captured_at`), not by upload completion time. This matters when different devices finish uploading in a different order.

## Main site modes

**Professional Mode OFF** is the default consumer view. It focuses on:

- target;
- Followers / Following;
- four relationship-change counts;
- the full list of accounts in each change category.

**Professional Mode ON** additionally shows technical telemetry, pagination, cloud validation, samples, viewer consistency, and history.

The mode preference is stored in the browser.

## Install / update extension

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository folder.
5. Whenever extension files change, click **Reload** on the QuetUnfollowIG extension card.
6. Make sure `instagram.com` is signed in in the same browser.
7. Open the extension popup and copy the Main Site pairing key.
8. Open https://quet-unfollow-ig.vercel.app and paste the pairing key.

Current extension version: **1.4.0**.

## Typical workflow

1. Paste the pairing key on the main site.
2. Enter a target or leave it blank for your own account.
3. Click **Connect**.
4. Click **Run crawl**.
5. The first successful run creates the cloud baseline for that target.
6. Run the same target again later.
7. Supabase compares it with the immediately previous complete run and the main site shows exactly which accounts changed.

Only one crawler may run at a time in an extension instance. A second request is rejected instead of running two overlapping Instagram crawls.

## Target resolution

For a non-self target, the extension currently tries multiple Instagram web endpoints because individual endpoints can be brittle:

1. `/api/v1/users/web_profile_info/?username=...`
2. `/api/v1/users/{username}/usernameinfo_stream/`
3. `/api/v1/feed/user/{username}/username/?count=1`

Instagram internal web endpoints are undocumented and may change without notice.

## Rate limits

The crawler adds randomized delay between pagination pages and treats HTTP 429 as rate limiting. Avoid repeatedly starting crawls in a short period.

A failed or incomplete run is not used as the previous-run reference for future diffs.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The extension manifest permits localhost for development.

Production build also runs syntax validation for the extension JavaScript before Next.js compilation:

```bash
npm run check:extension
npm run build
```

Top-level dependencies are pinned rather than using `latest` to reduce deployment drift.

## Supabase source

Database migrations are version-controlled in `supabase/migrations/` and the Edge Function source is in `supabase/functions/ig-cloud/index.ts`.

Crawler tables have RLS enabled and no client policies by design. Direct `anon` / `authenticated` table access is revoked; the Edge Function performs authorized operations with the service role after validating the Cloud Workspace Key.

## Privacy and limitations

- No Instagram password prompt.
- No Instagram password is stored.
- No Instagram cookie is uploaded to the website or cloud backend.
- The backend stores Instagram IDs, usernames, display names, relationship membership snapshots, crawl metadata, and computed changes.
- This project does not automatically follow or unfollow accounts.
- A list difference does not prove why the relationship changed.
- Private-account results can differ when different viewer accounts have different visibility; the backend records the viewer ID and the Professional UI warns when the viewer changed.

This project is unofficial and is not affiliated with Instagram or Meta.
