using Microsoft.AspNetCore.Identity;
using AppointmentApi.Models;

namespace AppointmentApi.Data
{
    public static class DbSeeder
    {
        public static void Seed(AppDbContext context)
        {
            context.Database.EnsureCreated();

            if (context.Branches.Any())
            {
                return; // DB already seeded
            }

            var passwordHasher = new PasswordHasher<string>();

            // 1. Seed Branches
            var istanbulBranch = new Branch
            {
                Name = "İstanbul Merkez Şubesi",
                Timezone = "Europe/Istanbul",
                Address = "Kadıköy, İstanbul"
            };

            var londonBranch = new Branch
            {
                Name = "London Central Branch",
                Timezone = "Europe/London",
                Address = "Soho, London"
            };

            context.Branches.AddRange(istanbulBranch, londonBranch);
            context.SaveChanges();

            // 2. Seed Users
            var adminUser = new User
            {
                Name = "Sistem Yöneticisi",
                Email = "admin@system.com",
                Role = UserRole.Admin,
                BranchId = null
            };
            adminUser.PasswordHash = passwordHasher.HashPassword(adminUser.Email, "Admin123!");

            var istManager = new User
            {
                Name = "İstanbul Şube Müdürü",
                Email = "ist_manager@system.com",
                Role = UserRole.Manager,
                BranchId = istanbulBranch.Id
            };
            istManager.PasswordHash = passwordHasher.HashPassword(istManager.Email, "Manager123!");

            var staffAhmet = new User
            {
                Name = "Ahmet Yılmaz (Berber)",
                Email = "ahmet@system.com",
                Role = UserRole.Staff,
                BranchId = istanbulBranch.Id
            };
            staffAhmet.PasswordHash = passwordHasher.HashPassword(staffAhmet.Email, "Staff123!");

            var staffMehmet = new User
            {
                Name = "Mehmet Demir (Kuaför)",
                Email = "mehmet@system.com",
                Role = UserRole.Staff,
                BranchId = istanbulBranch.Id
            };
            staffMehmet.PasswordHash = passwordHasher.HashPassword(staffMehmet.Email, "Staff123!");

            var customerAli = new User
            {
                Name = "Ali Yurtlu",
                Email = "ali@customer.com",
                Role = UserRole.Customer,
                BranchId = istanbulBranch.Id
            };
            customerAli.PasswordHash = passwordHasher.HashPassword(customerAli.Email, "Customer123!");

            var customerAyse = new User
            {
                Name = "Ayşe Kaya",
                Email = "ayse@customer.com",
                Role = UserRole.Customer,
                BranchId = istanbulBranch.Id
            };
            customerAyse.PasswordHash = passwordHasher.HashPassword(customerAyse.Email, "Customer123!");

            var staffCem = new User
            {
                Name = "Cem Yıldız (Cilt Bakım Uzmanı)",
                Email = "cem@system.com",
                Role = UserRole.Staff,
                BranchId = istanbulBranch.Id
            };
            staffCem.PasswordHash = passwordHasher.HashPassword(staffCem.Email, "Staff123!");

            var staffElif = new User
            {
                Name = "Elif Kaya (Manikür & Pedikür)",
                Email = "elif@system.com",
                Role = UserRole.Staff,
                BranchId = istanbulBranch.Id
            };
            staffElif.PasswordHash = passwordHasher.HashPassword(staffElif.Email, "Staff123!");

            context.Users.AddRange(adminUser, istManager, staffAhmet, staffMehmet, staffCem, staffElif, customerAli, customerAyse);
            context.SaveChanges();

            // 3. Seed Services for Istanbul
            var haircut = new Service
            {
                BranchId = istanbulBranch.Id,
                Name = "Saç Kesimi",
                DurationMinutes = 45,
                Price = 250.00m
            };

            var hairColoring = new Service
            {
                BranchId = istanbulBranch.Id,
                Name = "Saç Boyama",
                DurationMinutes = 120,
                Price = 800.00m
            };

            var beardShave = new Service
            {
                BranchId = istanbulBranch.Id,
                Name = "Sakal Tıraşı",
                DurationMinutes = 30,
                Price = 100.00m
            };

            var skinCare = new Service
            {
                BranchId = istanbulBranch.Id,
                Name = "Cilt Bakımı",
                DurationMinutes = 60,
                Price = 450.00m
            };

            var manicure = new Service
            {
                BranchId = istanbulBranch.Id,
                Name = "Manikür & Pedikür",
                DurationMinutes = 60,
                Price = 350.00m
            };

            var hairCare = new Service
            {
                BranchId = istanbulBranch.Id,
                Name = "Keratin Saç Bakımı",
                DurationMinutes = 90,
                Price = 600.00m
            };

            context.Services.AddRange(haircut, hairColoring, beardShave, skinCare, manicure, hairCare);
            context.SaveChanges();

            // 4. Seed Working Hours
            // Ahmet works Mon-Sat: 09:00 - 18:00 (Lunch: 12:00 - 13:00)
            var days = new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday, DayOfWeek.Saturday };
            foreach (var day in days)
            {
                context.WorkingHours.Add(new WorkingHour
                {
                    UserId = staffAhmet.Id,
                    DayOfWeek = day,
                    StartTime = new TimeSpan(9, 0, 0),
                    EndTime = new TimeSpan(18, 0, 0),
                    LunchStartTime = new TimeSpan(12, 0, 0),
                    LunchEndTime = new TimeSpan(13, 0, 0)
                });
            }

            // Mehmet works Mon-Fri: 10:00 - 19:00 (Lunch: 13:00 - 14:00)
            var mehmetDays = new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday };
            foreach (var day in mehmetDays)
            {
                context.WorkingHours.Add(new WorkingHour
                {
                    UserId = staffMehmet.Id,
                    DayOfWeek = day,
                    StartTime = new TimeSpan(10, 0, 0),
                    EndTime = new TimeSpan(19, 0, 0),
                    LunchStartTime = new TimeSpan(13, 0, 0),
                    LunchEndTime = new TimeSpan(14, 0, 0)
                });

                context.WorkingHours.Add(new WorkingHour
                {
                    UserId = staffCem.Id,
                    DayOfWeek = day,
                    StartTime = new TimeSpan(11, 0, 0),
                    EndTime = new TimeSpan(20, 0, 0),
                    LunchStartTime = new TimeSpan(14, 0, 0),
                    LunchEndTime = new TimeSpan(15, 0, 0)
                });

                context.WorkingHours.Add(new WorkingHour
                {
                    UserId = staffElif.Id,
                    DayOfWeek = day,
                    StartTime = new TimeSpan(9, 30, 0),
                    EndTime = new TimeSpan(18, 30, 0),
                    LunchStartTime = new TimeSpan(13, 0, 0),
                    LunchEndTime = new TimeSpan(14, 0, 0)
                });
            }

            context.SaveChanges();
        }
    }
}
