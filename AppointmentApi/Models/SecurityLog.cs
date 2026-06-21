using System.ComponentModel.DataAnnotations;

namespace AppointmentApi.Models
{
    public class SecurityLog
    {
        public int Id { get; set; }
        
        public int? UserId { get; set; }
        
        [Required]
        [MaxLength(100)]
        public string Action { get; set; } = string.Empty; // e.g. "AUTHORIZATION_FAILURE", "UNAUTHORIZED_BOOKING_ATTEMPT", "JWT_INVALID"
        
        [MaxLength(50)]
        public string IpAddress { get; set; } = string.Empty;
        
        [MaxLength(500)]
        public string UserAgent { get; set; } = string.Empty;
        
        [Required]
        public string Details { get; set; } = string.Empty;
        
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        
        // Navigation properties
        public User? User { get; set; }
    }
}
