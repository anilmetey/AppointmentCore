using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace AppointmentApi.Models
{
    public enum AppointmentStatus
    {
        Pending,
        Approved,
        Cancelled
    }

    public class Appointment
    {
        public int Id { get; set; }
        
        [Required]
        public int BranchId { get; set; }
        
        [Required]
        public int CustomerId { get; set; }
        
        [Required]
        public int EmployeeId { get; set; }
        
        [Required]
        public int ServiceId { get; set; }
        
        [Required]
        public DateTime StartTimeUtc { get; set; }
        
        [Required]
        public DateTime EndTimeUtc { get; set; }
        
        [Required]
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public AppointmentStatus Status { get; set; } = AppointmentStatus.Pending;
        
        [Required]
        [Column(TypeName = "decimal(18,2)")]
        public decimal Price { get; set; }
        
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        
        // Navigation properties
        public Branch? Branch { get; set; }
        public User? Customer { get; set; }
        public User? Employee { get; set; }
        public Service? Service { get; set; }
    }
}
