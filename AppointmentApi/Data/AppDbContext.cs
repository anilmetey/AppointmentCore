using Microsoft.EntityFrameworkCore;
using AppointmentApi.Models;

namespace AppointmentApi.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
        {
        }

        public DbSet<Branch> Branches => Set<Branch>();
        public DbSet<User> Users => Set<User>();
        public DbSet<Service> Services => Set<Service>();
        public DbSet<WorkingHour> WorkingHours => Set<WorkingHour>();
        public DbSet<Appointment> Appointments => Set<Appointment>();
        public DbSet<SecurityLog> SecurityLogs => Set<SecurityLog>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<User>()
                .HasIndex(u => u.Email)
                .IsUnique();

            modelBuilder.Entity<WorkingHour>()
                .HasIndex(w => new { w.UserId, w.DayOfWeek })
                .IsUnique();

            // Configure Appointment -> Customer (User) relationship
            modelBuilder.Entity<Appointment>()
                .HasOne(a => a.Customer)
                .WithMany(u => u.CustomerAppointments)
                .HasForeignKey(a => a.CustomerId)
                .OnDelete(DeleteBehavior.Restrict);

            // Configure Appointment -> Employee (User) relationship
            modelBuilder.Entity<Appointment>()
                .HasOne(a => a.Employee)
                .WithMany(u => u.EmployeeAppointments)
                .HasForeignKey(a => a.EmployeeId)
                .OnDelete(DeleteBehavior.Restrict);

            // Configure Appointment -> Service relationship
            modelBuilder.Entity<Appointment>()
                .HasOne(a => a.Service)
                .WithMany(s => s.Appointments)
                .HasForeignKey(a => a.ServiceId)
                .OnDelete(DeleteBehavior.Restrict);

            // Configure Appointment -> Branch relationship
            modelBuilder.Entity<Appointment>()
                .HasOne(a => a.Branch)
                .WithMany(b => b.Appointments)
                .HasForeignKey(a => a.BranchId)
                .OnDelete(DeleteBehavior.Restrict);

            // Configure User -> Branch relationship
            modelBuilder.Entity<User>()
                .HasOne(u => u.Branch)
                .WithMany(b => b.Users)
                .HasForeignKey(u => u.BranchId)
                .OnDelete(DeleteBehavior.Restrict);

            // Configure Service -> Branch relationship
            modelBuilder.Entity<Service>()
                .HasOne(s => s.Branch)
                .WithMany(b => b.Services)
                .HasForeignKey(s => s.BranchId)
                .OnDelete(DeleteBehavior.Restrict);

            // Configure WorkingHour -> User relationship
            modelBuilder.Entity<WorkingHour>()
                .HasOne(w => w.User)
                .WithMany(u => u.WorkingHours)
                .HasForeignKey(w => w.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // Configure SecurityLog -> User relationship
            modelBuilder.Entity<SecurityLog>()
                .HasOne(s => s.User)
                .WithMany()
                .HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.SetNull);
        }
    }
}
