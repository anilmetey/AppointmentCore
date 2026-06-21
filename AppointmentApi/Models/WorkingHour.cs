using System.ComponentModel.DataAnnotations;

namespace AppointmentApi.Models
{
    public class WorkingHour
    {
        public int Id { get; set; }
        
        [Required]
        public int UserId { get; set; } // Staff user
        
        [Required]
        public DayOfWeek DayOfWeek { get; set; } // 0=Sunday, 6=Saturday
        
        [Required]
        public TimeSpan StartTime { get; set; }
        
        [Required]
        public TimeSpan EndTime { get; set; }
        
        public TimeSpan? LunchStartTime { get; set; }
        public TimeSpan? LunchEndTime { get; set; }
        
        // Navigation properties
        public User? User { get; set; }
    }
}
