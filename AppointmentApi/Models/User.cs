using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace AppointmentApi.Models
{
    public enum UserRole
    {
        Admin,
        Manager,
        Staff,
        Customer
    }

    public class User
    {
        public int Id { get; set; }
        
        // Nullable for Global Admin
        public int? BranchId { get; set; }
        
        [Required]
        [MaxLength(100)]
        public string Name { get; set; } = string.Empty;
        
        [Required]
        [EmailAddress]
        [MaxLength(100)]
        public string Email { get; set; } = string.Empty;
        
        [Required]
        [JsonIgnore]
        public string PasswordHash { get; set; } = string.Empty;
        
        [Required]
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public UserRole Role { get; set; } = UserRole.Customer;
        
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        
        // Navigation properties
        public Branch? Branch { get; set; }
        public ICollection<WorkingHour> WorkingHours { get; set; } = new List<WorkingHour>();
        public ICollection<Appointment> CustomerAppointments { get; set; } = new List<Appointment>();
        public ICollection<Appointment> EmployeeAppointments { get; set; } = new List<Appointment>();
    }
}
