# AppointmentCore

AppointmentCore, profesyonel işletmeler için tasarlanmış, çok kiracılı (multi-tenant) şube mimarisine sahip kapsamlı bir randevu yönetim platformudur. Bu sistem, hem müşteriler hem de işletme personeli için optimize edilmiş akıcı ve modern bir kullanıcı deneyimi sunar. 

## Özellikler

- **Şube ve Uzman Bazlı Randevu Sistemi:** Müşteriler, istedikleri şube, uzman ve hizmeti seçerek anında boş saatleri görebilir ve rezervasyon yapabilir.
- **Akıllı Kapasite Yönetimi:** Hizmet süresine ve uzmanların çalışma/mola saatlerine göre otomatik slot (zaman dilimi) hesaplaması.
- **Dinamik Müşteri Panelleri:** Yaklaşan, iptal edilen ve geçmiş randevuların tek bir ekranda detaylı takibi, "takvime ekleme" (ICS) ve hatırlatma paylaşımı desteği.
- **Yönetici Çözümlemeleri:** Randevu doluluk oranları, iptal risk analizleri, operasyon kalitesi, günlük ajandalar ve finansal raporların CSV/JSON dışa aktarımı ile zenginleştirilmiş karar destek panoları.
- **Gelişmiş Güvenlik ve İzolasyon:** JWT tabanlı kimlik doğrulama, rol bazlı erişim kontrolü (RBAC) ve her kullanıcının sadece kendi yetkili olduğu şubelerde işlem yapmasını sağlayan "Pessimistic Locking" ile güçlendirilmiş Multi-Tenant altyapı.

## Teknolojiler

- **Backend:** C# / .NET 9 Web API, Entity Framework Core, SQLite (veritabanı)
- **Frontend:** HTML5, CSS3 (Modern Glassmorphism tasarım), Vanilla JavaScript
- **Mimarî Yaklaşımlar:** RESTful API, Repository Pattern, Asynchronous Programming

## Başlangıç

Projeyi yerel ortamınızda çalıştırmak için:

1. **Backend:**
   ```bash
   cd AppointmentApi
   dotnet run
   ```

2. **Frontend:**
   `AppointmentClient` klasöründeki `index.html` dosyasını tarayıcınızda açarak (veya basit bir lokal sunucu ile örneğin `npx http-server`) sisteme erişebilirsiniz.
