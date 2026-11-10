# Nhật ký thay đổi

Bản tiếng Việt của [CHANGELOG.md](../../CHANGELOG.md), hiện trong mục "Có gì mới" của panel khi panel dùng tiếng Việt.

## [2.5.2] - 2026-11-10

### Thay đổi

- Prompt đã cải thiện theo hướng dẫn của Anthropic cho Claude Fable 5.2. Với việc nhiều bước, agent được dặn làm xong mọi phần, vượt qua lệnh lỗi và hết giờ thay vì dừng lại; chỉ sửa phần việc cần và liệt kê vấn đề lân cận ở cuối; nói trước việc sắp làm và kết thúc bằng bản tóm tắt tự đứng được. Việc nhỏ không có những phần này. Chỗ cần xin phép nêu đúng hành động, việc bạn đã cho phép được ghi là đã cho phép, và agent không còn bị dặn cách suy nghĩ, lập kế hoạch hay chia việc cho agent con.

### Sửa lỗi

- Khi model Claude từ chối một yêu cầu, panel nói rõ model nào và vì sao, thay vì "câu trả lời rỗng"; chế độ dự phòng chuyển sang model kế tiếp.

## [2.5.1] - 2026-11-10

### Sửa lỗi

- Model Claude mới hiện trong danh sách model của Claude Code (gói subscription) ngay khi Claude Code biết tới: Fable 5.2 bị thiếu vì chính menu /model của Claude Code vẫn dừng ở Fable 5.1. Model mới nhất đứng đầu danh sách, và danh sách đã lưu được làm mới.

## [2.5.0] - 2026-11-10

### Thêm mới

- Tận dụng thêm những gì Orca biết, mỗi thứ có công tắc riêng trong Cài đặt, tất cả tắt cho tới khi bạn bật: **Đọc phiên của các agent khác** (mức Tối đa: các agent khác trong workspace và những dòng cuối trong terminal của chúng, đã che key và mật khẩu; bạn chọn số agent, 1 đến 8, và số dòng, 10 đến 300), **Theo dõi việc các agent làm** (mức Sâu và Tối đa: công cụ agent chạy và đối tượng của nó, không bao giờ lấy kết quả, chỉ giữ trong bộ nhớ 45 phút), **Ghi nhận tệp bạn lưu** (đường dẫn tệp lưu trong trình soạn thảo của Orca được ưu tiên khi tìm code), **Mở agent mới** (nút mở Claude Code, Codex hoặc Gemini kèm prompt đã cải thiện), **Mở tệp trong Orca** (từ danh sách ngữ cảnh) và thông báo khi một lần chạy lâu xong.
- Các công tắc gửi thêm dữ liệu cho model hoặc mở chương trình sẽ hiện toàn bộ những gì chúng cho phép và hỏi bạn xác nhận trước khi bật. Chỉ bật trong Settings của Orca thì chúng vẫn tắt cho tới khi bạn xác nhận trong panel.

### Sửa lỗi

- Dán, kéo-thả hoặc đính kèm ảnh hay tệp bị lỗi "message too large": panel gửi theo từng phần 768 KB, trong khi Orca chỉ nhận tối đa 64 KiB mỗi request. Giờ mỗi phần là 44 KiB, nên mọi ảnh tới 5 MB và tệp tới 10 MB đều đính kèm được; tệp quá giới hạn bị từ chối ngay, kèm kích thước và giới hạn.

### Thay đổi

- Panel không còn thanh cuộn (vẫn cuộn được).
- Orca sẽ hỏi duyệt lại plugin: bản này thêm quyền mở agent, mở tệp trong Orca, hiện thông báo, và hai hook quan sát công cụ của agent và việc lưu tệp (không bao giờ thay đổi hay chặn gì).

## [2.4.5] - 2026-11-09

### Thay đổi

- Logo và hình nền cover được vẽ lại bằng gpt-image-2.6-sunburst: ngôi sao to và rõ hơn ở kích thước nhỏ, cover thoáng hơn. Mọi ảnh giới thiệu, ảnh README và ảnh hướng dẫn đều dùng bản mới.

## [2.4.4] - 2026-11-09

### Thay đổi

- "Có gì mới" và nhật ký thay đổi hiện theo ngôn ngữ của panel: tiếng Việt, tiếng Anh hoặc tiếng Trung.

## [2.4.3] - 2026-11-09

### Thay đổi

- Logo nổi rõ trên nền tối: icon có viền sáng mảnh, logo cạnh tiêu đề chuyển sang màu trắng ở giao diện tối.
- README, hướng dẫn sử dụng và tài liệu dùng ảnh và mô tả của panel mới: dán, kéo-thả hoặc đính kèm tệp, Enter để cải thiện, tùy chọn kèm danh sách ngữ cảnh, quy tắc theo dự án, sửa được cấu trúc, Có gì mới.

## [2.4.2] - 2026-11-09

### Thêm mới

- Có gì mới và nhật ký thay đổi: bấm số phiên bản cạnh tiêu đề. Sau mỗi lần cập nhật, Có gì mới tự mở một lần.
- Logo cạnh tiêu đề panel.

### Thay đổi

- Ngữ cảnh gửi đi luôn được liệt kê trong Tùy chọn (mở Tùy chọn là tự đọc); bỏ dòng gập và tiêu đề của nó.
- Ô chọn model trong khung soạn rộng hơn.

### Sửa lỗi

- Ảnh giới thiệu hiện trọn panel, không còn bị cắt mất góc dưới.

## [2.4.1] - 2026-11-09

### Thay đổi

- Logo mới: ô vuông phẳng, đơn sắc, có dấu nhắc terminal và ngôi sao, vẽ bằng gpt-image-2.5-sunburst.
- Ảnh giới thiệu mới: cover và ba ảnh chụp lấy từ panel mới.
- Thời gian trong Lịch sử hiện theo ngôn ngữ của panel.

## [2.4.0] - 2026-11-09

### Thay đổi

- Panel web thay panel cũ: Orca giờ chỉ có một panel Enhance Prompt (icon bóng đèn) với dán, kéo-thả và đính kèm tệp, Enter để cải thiện, thông báo dạng toast và sửa được cấu trúc.

## [2.3.1] - 2026-11-09

### Thay đổi

- Icon của panel web ở thanh bên là tia sét thay cho quả địa cầu, để trông như một công cụ chứ không phải trang web.

## [2.3.0] - 2026-11-09

### Thêm mới

- Panel web mới, Enhance Prompt (web), dựng bằng React và shadcn/ReUI, chạy song song panel cũ: dán ảnh chụp màn hình, kéo-thả tệp hoặc đính kèm bằng nút kẹp giấy, nhấn Enter để cải thiện (Shift+Enter để xuống dòng).
- Đính kèm mọi loại tệp (tối đa 8 tệp, mỗi tệp 10 MB): ảnh gửi cho model xem được ảnh, tệp chữ ngắn đưa vào ngữ cảnh, và prompt đã cải thiện ghi đường dẫn từng tệp để agent tự mở.
- Sửa được các cấu trúc prompt có sẵn, và khôi phục về mặc định.
- Viết được hướng dẫn riêng cho kiểu "Chỉ dùng hướng dẫn riêng" ngay trong Tùy chọn.

### Thay đổi

- Trong panel web, quy tắc áp dụng cho dự án đang mở, thông báo là toast, màu đen trắng trung tính.
- Mỗi dự án giữ được tới 1000 quy tắc thay vì 50.

### Ghi chú

- Bản dịch chuyển sang src/i18n-dict.ts, dùng chung cho cả hai panel. Mã nguồn panel web ở web/ và được build vào src/web-dist (npm run web:build).

## [2.2.2] - 2026-11-09

### Thay đổi

- Công cụ của khung soạn là các nút có chữ dưới ô prompt (Ảnh, Sửa lỗi, Tùy chọn, Xem trước) thay cho bốn icon trơn; nút Cải thiện nằm cạnh ô chọn model.
- Thông báo là một dòng có nền màu nhạt và nút đóng, không còn tiêu đề "Note" chưa dịch.
- Xem trước mở danh sách ngữ cảnh (tiêu đề đã có số mục và số ký tự) thay vì hiện thông báo lặp lại các con số đó.

## [2.2.1] - 2026-11-09

### Sửa lỗi

- Ngữ cảnh dự án chạy lại trên Orca mới: Orca giờ gọi workspace trên máy này là "local" thay vì để trống, nên mọi workspace bị coi là SSH/WSL và các bước quy tắc, git, tìm code, AI chọn file đều bị bỏ qua.
- Phân biệt được nhiều workspace cùng tên và cùng nhánh (nhiều bản checkout trên "main"): panel học workspace của từng terminal từ sự kiện agent của Orca, và nếu vẫn chưa rõ thì hỏi một lần thư mục của dự án.

### Thay đổi

- Bỏ dòng giải thích dưới các bước tiến độ; dấu ≈ cạnh phần của model vẫn đánh dấu ước lượng.

## [2.2.0] - 2026-11-09

### Thêm mới

- Đính kèm ảnh vào prompt: bấm icon tải lên và dán đường dẫn đầy đủ của tệp PNG, JPEG, GIF hoặc WebP (tối đa 4 ảnh, mỗi ảnh 5 MB). Model xem được ảnh nhận ảnh (Anthropic, các preset OpenAI, OpenRouter và Gemini; Codex CLI với `-i`), model khác nhận đường dẫn, và prompt đã cải thiện luôn ghi đường dẫn để agent mở. Tệp không có, sai loại hoặc quá lớn bị từ chối kèm lý do trước khi gọi model.
- Thẻ tiến độ hiện phần trăm: tổng và từng bước, có thanh nhỏ dưới bước đang chạy. Bước đếm được thì tăng dần (lệnh git, từ đã tìm, phần dự án đã đọc); lời gọi model là ước lượng đánh dấu ≈, chỉ đạt 100% khi có câu trả lời. Khi hủy hoặc lỗi, phần trăm đã đạt được giữ lại.
- Hướng dẫn sử dụng có ảnh: docs/user-guide.md.

### Thay đổi

- Logo phẳng mới (ô màu chàm, dấu nhắc trắng, ngôi sao vàng) và màu phẳng trong ảnh giới thiệu: không dùng dải chuyển màu.
- "Enhance Prompt" là tên riêng nên giữ nguyên ở mọi ngôn ngữ: tiêu đề panel và thanh trạng thái đều hiện đúng tên này ở tiếng Anh, tiếng Việt và tiếng Trung.

### Ghi chú

- `npm run mock:progress` (hoặc http://localhost:5173/mock-progress khi chạy `npm run dev`) phát lại thẻ tiến độ qua các lần chạy giả lập; `node scripts/make-guide-images.mjs` vẽ ảnh cho hướng dẫn.

## [2.1.1] - 2026-11-09

### Sửa lỗi

- Prompt đã cải thiện ở lại đúng dự án nơi nó được viết. Chuyển dự án thì bản nháp và kết quả của từng dự án tách riêng, nên nút Gửi không thể dán prompt của dự án này vào agent của dự án khác; câu trả lời về sau khi bạn đã chuyển dự án sẽ chờ ở dự án của nó, còn câu trả lời cho dự án đã đóng thì bị bỏ.

### Thêm mới

- Panel hiện số phiên bản cạnh tiêu đề (ví dụ "Enhance v2.1.1").
- Mục Góp ý (icon bánh răng) có nút mở issue trên GitHub; các README cũng mời bạn gửi issue.

## [2.1.0] - 2026-11-09

### Thêm mới

- Sửa lỗi này: bấm icon con bọ, chọn terminal nơi build, test hoặc dev server bị lỗi, Enhance đọc lỗi mới nhất (tối đa 150 dòng) và viết prompt sửa lỗi cho agent bạn gửi tới. Tuân theo Quyền riêng tư → Đọc output terminal.
- Tab Quy tắc: quy tắc riêng của bạn cho bộ viết lại, cho mọi workspace hoặc chỉ một, dùng cho mọi lần Cải thiện và cho tự cải thiện bằng AI; và cấu trúc prompt, các tiêu đề prompt được viết theo (có sẵn Brief nhiệm vụ và Các bước, hoặc của bạn bằng bất kỳ ngôn ngữ nào), chọn trong Tùy chọn của khung soạn.

### Thay đổi

- Prompt đã cải thiện theo hướng dẫn viết prompt của Anthropic và OpenAI: giữ lý do bạn đưa ra, chỉ dẫn nói điều cần làm thay vì điều không được làm, giọng văn bình thường (không MUST / IMPORTANT), agent được dặn khi nào dừng lại hỏi và phải báo các lệnh đã chạy kèm kết quả, tránh chỉ dẫn mâu thuẫn nhau.
- Prompt đã cải thiện không còn chép lại AGENTS.md hay CLAUDE.md (agent tự đọc), chỉ nêu một hai lệnh kiểm tra thay vì tất cả, để agent tự quyết các lựa chọn còn mở, và giữ ngắn khi yêu cầu nhỏ; kiểu Ngắn gọn ngắn thật; Claude Code chỉ nhận tiêu đề Markdown.
- Ngữ cảnh Sâu và Tối đa nhanh hơn trên repo lớn: git status, log và diff chạy song song.

### Ghi chú

- `scripts/eval-prompts.mjs` kiểm tra bộ viết lại trên các tình huống cố định với một model thật. Xóa toàn bộ cũng xóa quy tắc và cấu trúc của bạn.

## [2.0.2] - 2026-11-09

### Sửa lỗi

- Hủy và hết thời gian giờ dừng hẳn lần chạy: CLI gói subscription bị dừng cùng mọi thứ nó đã khởi chạy (kể cả bản Codex và Gemini cài qua npm `.cmd` trên Windows), các lệnh git đang chạy bị dừng, và không bước nào bắt đầu sau khi hủy.
- Lần chạy trả lời trong thời gian chờ 120 giây của panel, dù chuỗi dự phòng thử bao nhiêu model; câu trả lời đến sau khi panel đã thôi chờ bị bỏ và không lưu vào lịch sử.
- "Mặc định của CLI" chạy CLI đúng với model mặc định của nó (Claude Code từng bị gửi `--model haiku`). Tắt, bật hoặc đổi model từ thẻ của nó không còn ghi URL và model của preset vào hồ sơ.
- Tự cải thiện bằng AI chỉ cho chọn model API đang bật (CLI gói subscription quá chậm so với giới hạn 2 giây), và panel cảnh báo khi không có model nào chạy được thay vì lặng lẽ không làm gì.
- Endpoint model trả về trang HTML hoặc rỗng (proxy, trang đăng nhập Wi-Fi) cho lỗi rõ ràng và dự phòng chuyển tiếp, kể cả khi chọn "chỉ lỗi tạm thời".
- `claude --help` từng lỗi một lần sẽ được hỏi lại; lần chạy CLI bị hủy không để lại thư mục tạm.

### Bảo mật

- Thay đổi chưa commit ở các tệp bí mật (thông tin đăng nhập, secrets, khóa riêng, chứng chỉ) và ở các mẫu loại trừ của bạn không được đưa vào git diff gửi ở mức Sâu và Tối đa, kể cả tệp bí mật đã đổi tên.
- Đọc git không bao giờ chạy chương trình `core.fsmonitor` của repo.
- Khi tắt "Lưu lịch sử", bản nháp và kết quả cuối không còn được giữ trên đĩa giữa các lần mở panel; "Xóa toàn bộ" cũng xóa chúng.
- Mục ngữ cảnh bạn bỏ tick sẽ không bị đọc chút nào (ví dụ output terminal).

### Thay đổi

- Lịch sử: xóa một mục và Xóa lịch sử đi qua worker, theo đúng thứ tự với các mục mới (không mất mục nào); Xóa lịch sử cần bấm hai lần; prompt rất dài được cắt bớt khi lưu và toàn bộ lịch sử bị giới hạn dung lượng; tab Lịch sử hiện 50 mục một lần, có nút Xem thêm.
- Lỗi, ghi chú ngữ cảnh và nhãn từ worker hiện theo ngôn ngữ của panel (có tiếng Việt và tiếng Trung).
- Danh sách model của Gemini CLI lấy từ `gemini models list` (Gemini CLI 0.67 trở lên) khi cho phép tải danh sách model qua mạng.
- Danh sách model của Claude Code được tải lại ngay khi Claude Code cập nhật, thay vì sau một ngày.

### Ghi chú

- Thêm test (tổng 99) và một bài kiểm tra đầu-cuối trong Orca thật (`scripts/e2e.mjs`); script phát hành chỉ commit manifest và changelog, từ nhánh `main` sạch, và chỉ với phiên bản kế tiếp.

## [2.0.1] - 2026-11-08

### Sửa lỗi

- Panel mở nhanh hơn. Danh sách model của Claude Code đọc thẳng từ các byte của tệp chương trình và được nhớ tới khi tệp đó đổi, `claude --help` chỉ đọc một lần mỗi phiên bản, và các yêu cầu cùng lúc của panel cho một danh sách dùng chung một lần tải. Số liệu dữ liệu đã lưu chỉ tải khi mở Quyền riêng tư.
- Chữ gửi vào terminal không còn mang ký tự điều khiển (ESC, Ctrl-C, DEL…) từ câu trả lời của model, nên không thể gõ phím vào agent.
- Lần gửi lỗi giữa chừng vẫn đóng bracketed paste, nên agent không bị kẹt ở chế độ dán.
- Xem trước ngữ cảnh giờ tuân theo các công tắc Quyền riêng tư (tệp dự án, git, output terminal) giống hệt một lần chạy.
- Tự cải thiện (AI) không còn thêm ngữ cảnh dự án đã lưu đệm khi tắt "Đọc tệp dự án".
- Danh sách model chỉ dùng API key từ biến môi trường khi công tắc Quyền riêng tư đó bật.
- Lịch sử không còn mất mục khi một lần chạy của panel và tự cải thiện kết thúc cùng lúc.
- Đóng panel trong lúc chạy sẽ dừng lời gọi model; lần chạy bị hủy hiện bước đang mở là bỏ qua, không phải lỗi.

## [2.0.0] - 2026-11-08

### Sửa lỗi

- **Gửi prompt dài bị lỗi** "text: Too big: expected string to have <=4096 characters": Orca nhận tối đa 4096 ký tự mỗi lần ghi vào terminal, nên prompt giờ được gửi thành từng phần tối đa 4.000 ký tự, đúng thứ tự, vẫn là một lần dán (chỗ cắt rơi vào dấu xuống dòng và không bao giờ tách đôi một emoji).

### Thêm mới

- **Tiến độ trực tiếp khi cải thiện**: một thẻ hiện từng bước khi worker thực sự tới đó (workspace, quy tắc và stack của dự án, git, code liên quan, AI chọn file, terminal, rồi model kèm tên và lần thử dự phòng nếu có), một thanh đầy dần khi các bước xong, và đồng hồ đếm giờ. Lời gọi model không tự báo phần trăm nên là một bước kèm đồng hồ. Kết thúc là xong (kết quả hiện "Xong · x s"), lỗi (thẻ giữ lỗi kèm nút **Thử lại**) hoặc đã hủy; mỗi lần chạy bắt đầu mới, tiến độ của lần chạy cũ bị bỏ qua.

### Thay đổi

- **Quyền riêng tư chứa phần cài đặt**: ngôn ngữ panel và tự cải thiện (chế độ và model cho hook) chuyển từ mục Models sang đây, cạnh các công tắc quyền và dữ liệu đã lưu. Icon là bánh răng cài đặt. Giá trị đã lưu giữ nguyên.
- **Thiết kế lại khung soạn**: ô prompt và thanh công cụ nằm chung một thẻ; nút tùy chọn dùng icon phễu (để không nhầm với bánh răng cài đặt); nút Hủy thay nút Cải thiện khi đang chạy.
- Tên, loại của các mục ngữ cảnh và ghi chú của worker hiện theo ngôn ngữ của panel.

## [1.9.0] - 2026-11-08

### Thêm mới

- **Mọi model Claude theo tên**, không chỉ bí danh: Opus 5.5, Sonnet 5.5, Fable 5.1, Haiku 5.5, rồi các bản cũ hơn (Opus 4.8, 4.7, 4.6, Sonnet 4.6, Haiku 4.5…), kèm mô tả. Đọc từ bảng model có sẵn trong Claude Code đã cài (danh sách menu /model của nó hiện), nên luôn khớp với phiên bản của bạn. Các bí danh nằm cuối, dạng "sonnet (mới nhất)" và tương tự.
- Menu hiện tên hiển thị: "Claude Code · Fable 5.1" trong khung soạn, "Fable 5.1 — For your toughest challenges" trên thẻ model.

### Thay đổi

- Danh sách model đã lưu đệm từ các phiên bản trước bị bỏ qua, để danh sách mới hiện ngay.

## [1.8.2] - 2026-11-08

### Sửa lỗi

- **Không gì bị ẩn khi thanh bên hẹp**: dải tab của Orca ẩn những tab không vừa, nên panel giờ dùng thanh điều hướng bằng icon (Cải thiện, Lịch sử, Models, Quyền riêng tư) với tên mục bên trái; vừa mọi độ rộng. Hàng gửi và các hàng của thẻ model xuống dòng thay vì bị cắt.

### Thêm mới

- Nút **Mở trong Orca** và các bước cài từ danh mục cộng đồng trong README (tiếng Anh, tiếng Việt, tiếng Trung).
- Bản xem trước trực tiếp nhận `?width=` và `?theme=` trên URL.

## [1.8.1] - 2026-11-08

### Sửa lỗi

- Tab không còn tràn ra ngoài thanh bên hẹp: tên ngắn, không kèm số ("Privacy" là "Riêng tư" trong tiếng Việt).
- Các công tắc Quyền riêng tư là ô tick, nên mọi hàng thẳng hàng (Orca vẽ công tắc ngay sau nhãn).

### Thay đổi

- **Plugin nhẹ hơn khoảng 6 lần** (7,8 MB còn 1,3 MB): cover, ảnh chụp và ảnh README dùng JPEG, ảnh README ở 1,5x. Danh mục cộng đồng giữ lại các bản cập nhật lớn để duyệt.

## [1.8.0] - 2026-11-08

### Thêm mới

- **Tab Quyền riêng tư có công tắc cho từng loại quyền**: đọc tệp dự án, chạy git, đọc output terminal, gửi vào terminal, lưu lịch sử, dùng API key từ biến môi trường, tải danh sách model qua mạng. Orca duyệt quyền một lần cho cả plugin; các công tắc này quyết định plugin thực sự dùng gì, và worker kiểm tra chúng trước mỗi lần đọc, gửi, lưu hoặc tải. Cũng có trong Cài đặt dưới tên "Privacy: …".
- **Những gì được lưu, và xóa chúng**: số mục lịch sử, model đã lưu, key đã mã hóa và danh sách model đã lưu đệm, kèm Xóa lịch sử, Xóa danh sách model và Xóa toàn bộ (bấm hai lần).

### Thay đổi

- **Panel gọn hơn nhiều** (khoảng một nửa chiều cao):
  - Không có tiêu đề; menu ngôn ngữ chuyển xuống cuối tab Models.
  - Ô prompt không có nhãn; một hàng công cụ chứa menu model, Tùy chọn (⚙), Xem trước (🔍) và Cải thiện.
  - Kiểu, ngữ cảnh, ngôn ngữ đầu ra và "Nhấn Enter sau khi gửi" mở từ ⚙.
  - Thẻ kết quả có sao chép, tinh chỉnh tiếp và xóa dạng icon, và một hàng cho terminal và **Gửi**.
  - Thẻ model gồm hai hàng: vị trí, tên và thao tác; rồi menu model và trạng thái key. Bật hoặc tắt bằng icon tạm dừng/phát.
  - Menu model của khung soạn hiện tên ngắn, ví dụ "Claude Code · sonnet".

## [1.7.0] - 2026-11-08

### Thay đổi

- **Sắp xếp model bằng một cú bấm**: số trên mỗi thẻ model giờ là menu vị trí (#1, #2…); chọn #1 để thử model đó trước. Bỏ mũi tên lên/xuống. Giao diện plugin của Orca không có kéo-thả, nên đây là cách nhanh nhất để đổi chỗ model.
- **Tên model chi tiết** ở mọi nơi: tiêu đề hiện model sẽ trả lời, ví dụ "Claude Code · sonnet" hoặc "Tự động: Claude Code · haiku"; menu hiện id kèm mô tả, ví dụ "sonnet — Sonnet, newest".
- Menu model có hàng riêng phía trên **Cải thiện**, nên tên dài không đẩy lệch các nút.

## [1.6.2] - 2026-11-08

### Thay đổi

- Các đoạn giải thích dài chuyển vào icon thông tin (ⓘ): rê chuột để đọc, bấm để hiện thành thông báo. Áp dụng cho các mục của tab Models, phần cuối của nó (giờ là "Thêm cài đặt và quyền riêng tư ⓘ") và ghi chú CLI gói subscription trong biểu mẫu model.
- Bản xem trước trực tiếp nhận `?scenario=<tên>` trên URL.

## [1.6.1] - 2026-11-08

### Thêm mới

- **Xem trước giao diện trực tiếp trên localhost** khi phát triển: `npm run dev` mở http://localhost:5173 với mọi tình huống của panel đặt cạnh nhau, sáng/tối, chỉnh được độ rộng và các phần gập, vẽ lại mỗi lần lưu trong `src/`.

## [1.6.0] - 2026-11-08

### Thêm mới

- **Menu model cạnh nút Cải thiện**, giống ô chọn model của ChatGPT hay Claude: mọi model của mọi hồ sơ đang bật, lấy từ danh sách trực tiếp của nó (Claude Code · Haiku / Sonnet / Opus / Fable, Codex · từng model trong danh mục, model API), cùng **Tự động**. Model riêng của hồ sơ được đánh dấu **mặc định**.
- Model đã chọn chỉ dùng cho prompt đó; hồ sơ đã lưu và phần còn lại của chuỗi dự phòng giữ model của chúng. Huy hiệu ở tiêu đề hiện model đã chọn.

### Thay đổi

- Phần tùy chọn gập giờ chứa kiểu, ngữ cảnh và ngôn ngữ đầu ra; **Xem trước ngữ cảnh** là một nút icon.

## [1.5.0] - 2026-11-08

### Thay đổi

- **Thiết kế lại tab Cải thiện** quanh một luồng: viết, cải thiện, xem lại, gửi.
  - **Cải thiện** là nút chính; **Xem trước ngữ cảnh** nằm cạnh.
  - Kiểu, ngữ cảnh, ngôn ngữ đầu ra và model gập vào một dòng hiện lựa chọn hiện tại ("Sửa lỗi · Sâu · Tự động"); mở ra là bộ chọn hai cột có nhãn.
  - Kết quả là một thẻ: prompt, sao chép và xóa ở trên, rồi **Gửi tới**, công tắc Enter, **Gửi cho agent** (nút chính) và **Tinh chỉnh tiếp**.
  - Khi trống, panel giải thích rằng chưa có gì tới agent cho tới khi bạn bấm Gửi, kèm nút **Gửi nguyên văn**.
- **Tab Models chia mục**: Model của bạn, Dự phòng, Tự cải thiện (kèm model cho hook), Mức ngữ cảnh tối đa.
- **Logo mới**: ô tối giống icon của chính Orca, dấu nhắc và con trỏ, cùng ngôi sao chuyển màu tím-xanh.
- Ảnh giới thiệu và ảnh README giờ dùng giao diện tối, giống panel trong Orca.

### Sửa lỗi

- "Không có terminal trong workspace này", "Chọn một terminal" và phần cuối tab Models chưa được dịch.

## [1.4.0] - 2026-11-08

### Thêm mới

- **Danh sách model luôn mới**: ô Model là danh sách những gì mỗi nguồn đang cung cấp, nên bạn không còn phải gõ id model.
  - Claude Code: các bí danh (`haiku`, `sonnet`, `opus`, `fable`…), luôn trỏ tới model mới nhất. Đọc từ `claude --help` và schema cài đặt Claude Code trên schemastore.org, giới hạn theo `availableModels` của bạn, đánh dấu model mặc định.
  - Codex CLI: `codex debug models`, danh mục chính Codex hiện, đánh dấu model trong `config.toml` của bạn.
  - Gemini CLI: các model đã biết cùng model trong `~/.gemini/settings.json` của bạn.
  - API: `GET /models` của nhà cung cấp (Anthropic `/v1/models`), mới nhất trước.
  - Lưu đệm một ngày, có nút Làm mới, và **Khác (gõ id)…** cho model chưa có trong danh sách.
- **Đổi model tại chỗ** từ menu trên mỗi thẻ model.
- **Chế độ tự cải thiện ngay trong panel** (tab Models), cạnh dự phòng.
- **Icon mới**, từ `assets/icon.svg`.
- **Tài liệu theo định dạng của Orca**: README cùng bố cục với Orca (bảng tính năng, model hỗ trợ, cài đặt), README tiếng Việt và tiếng Trung, và các trang bắt đầu, mức ngữ cảnh, model, tự cải thiện, cài đặt, quyền riêng tư và xử lý sự cố.

### Thay đổi

- **Bấm mục ở thanh trạng thái giờ mở thanh bên phải**, nơi có panel; chú thích của nó giải thích panel, cài đặt và bản cập nhật nằm ở đâu. Để đổi chế độ tự cải thiện, dùng panel hoặc bảng lệnh.
- Lệnh mới **Enhance Prompt: Hiện / ẩn thanh bên phải**.

### Sửa lỗi

- Tùy chọn model "Mặc định của CLI" bị Orca bỏ vì giá trị của nó trống.
- Hai chuỗi trong biểu mẫu model chưa được dịch.

## [1.3.0] - 2026-11-08

### Thêm mới

- **Panel bằng tiếng Anh, tiếng Việt và tiếng Trung**: ô chọn ngôn ngữ ở góc trên bên phải panel, và cài đặt "Ngôn ngữ panel" (Tự động theo ngôn ngữ của Orca). Mọi nhãn, nút, gợi ý và thông báo đều được dịch.
- **Ngôn ngữ đầu ra cho từng prompt**: giống prompt, tiếng Anh, tiếng Việt hoặc tiếng Trung, cạnh Kiểu và Ngữ cảnh (cài đặt vẫn có thêm ngôn ngữ làm mặc định).
- **Tùy chọn thanh trạng thái**: menu chuột phải của thanh trạng thái Orca chỉ liệt kê mục của chính Orca, nên cài đặt mới "Mục thanh trạng thái" cho hiện icon và chữ, chỉ icon, hoặc ẩn. Mục này giờ hiện icon tia sét khi bật tự cải thiện, chữ và chú thích theo ngôn ngữ panel.
- Lệnh: `Auto-enhance with rules`, `Auto-enhance with AI`, `Show / hide status bar item`.
- **Ảnh giới thiệu**: cover và 3 ảnh chụp (ngữ cảnh, model, ngôn ngữ), cùng một ảnh chụp thật trong README. `scripts/make-images.mjs` tạo lại chúng từ chính cây component của panel với dữ liệu mẫu.

### Thay đổi

- Tab đang chọn, lần chạy cuối và danh sách ngữ cảnh được giữ khi bạn chuyển sang tab khác của thanh bên rồi quay lại.
- Model CLI hiện "model · Claude Code CLI" thay vì URL trống.

## [1.2.0] - 2026-11-08

### Thêm mới

- **Dùng gói subscription, không cần API key**: loại model mới chạy một CLI agent đã đăng nhập sẵn trên máy, ở chế độ chạy một lần:
  - Claude Code (Claude Pro/Max): `claude -p`, không công cụ, không lưu phiên, model mặc định `haiku`.
  - Codex CLI (gói ChatGPT): `codex exec`, sandbox chỉ đọc, phiên tạm.
  - Gemini CLI (tài khoản Google): `gemini -p`.
  - CLI tùy chỉnh: bất kỳ lệnh nào đọc prompt từ stdin và in ra câu trả lời.
- Tab Models phát hiện các CLI đã cài (PATH cùng các thư mục cài phổ biến) và thêm bằng một cú bấm.
- Model CLI tham gia chuỗi dự phòng như model API. Prompt truyền qua stdin và CLI chạy trong một thư mục tạm trống, nên nó không nạp quy tắc, hook hay tệp nào của riêng nó.

### Thay đổi

- Tìm code liên quan chính xác hơn nhiều:
  - Mỗi từ khóa được grep riêng và được tính trọng số theo độ hiếm trong repo (IDF), nên tên cụ thể như `agent.prompt.before` nặng hơn từ phổ biến như "timeout" hay "agent".
  - Tên có dấu chấm (`agent.prompt.before`, `user.profile.update`) được giữ nguyên làm từ tìm chính xác.
  - Khớp đường dẫn được tính theo độ cụ thể của từ khóa.
  - Đoạn trích được cắt quanh các dòng khớp, chỉ của những tệp được chọn.

### Ghi chú

- Tự cải thiện (hook giới hạn 2 giây) bỏ qua model CLI vì chúng mất vài giây để khởi động.
- Mỗi lời gọi CLI dùng hạn mức của chính CLI đó. Codex thêm system prompt lớn của riêng nó (khoảng 45k token mỗi lần gọi).

## [1.1.0] - 2026-11-08

### Thêm mới

- **5 mức ngữ cảnh dự án** (Tắt, Cơ bản, Chuẩn, Sâu, Tối đa), làm mặc định và cho từng prompt:
  - Chuẩn: tệp quy tắc agent (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules`, hướng dẫn Copilot), tóm tắt README, stack và lệnh thực tế, cây thư mục. Lưu đệm theo workspace.
  - Sâu: git status, các commit gần đây, diff chưa commit, code liên quan tới prompt.
  - Tối đa: tệp do AI chọn (hai bước) và output gần đây của terminal agent đích.
- Danh sách "Ngữ cảnh đã dùng" bỏ được từng mục, và **Xem trước ngữ cảnh**.
- **Nhiều model**: 10 preset (OpenAI, Anthropic, OpenRouter, Gemini, Groq, DeepSeek, Mistral, Ollama, LM Studio, tùy chỉnh), sắp xếp, bật/tắt, kiểm tra, chọn theo từng prompt, một model cho hook và một model cho bộ chọn file.
- **Dự phòng** giữa các model, khi gặp mọi lỗi hoặc chỉ lỗi mạng/hết giờ/429/5xx.
- Prompt theo từng agent cho Claude Code, Codex, Gemini CLI và Aider.
- Cài đặt: tệp luôn đưa vào, mẫu loại trừ, số dòng terminal, thích ứng theo agent.

### Bảo mật

- Các tệp `.env*`, `*.pem`, `*.key`, thông tin đăng nhập và bí mật không bao giờ bị đọc, liệt kê, grep hay diff.

## [1.0.0] - 2026-11-08

### Thêm mới

- Panel Cải thiện: viết, cải thiện, sửa, rồi gửi vào terminal agent, sao chép hoặc tinh chỉnh tiếp.
- API tương thích OpenAI và Anthropic, key lưu trong kho bí mật được mã hóa của Orca.
- 9 kiểu, ngôn ngữ đầu ra, hướng dẫn riêng.
- Lịch sử có tìm kiếm, dùng lại, sao chép và xóa.
- Hook tự cải thiện cho prompt Orca gửi tới agent (quy tắc hoặc AI), bật tắt từ thanh trạng thái.
- Bracketed paste cho prompt nhiều dòng.
